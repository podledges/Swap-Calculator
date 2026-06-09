# src/quant/swap_legs.py
from abc import ABC, abstractmethod
import numpy as np
import datetime
from typing import List, Dict
from quant.day_counter import calculate_year_fraction, generate_forward_schedule


class SwapLeg(ABC):
    @abstractmethod
    def generate_cashflows(self, curve_builder, trade_date: datetime.date, maturity_date: datetime.date, is_payer: bool) -> List[Dict]:
        """Calculates the schedule of cash flows for this specific leg."""
        pass


class InterestRateLeg(SwapLeg):
    # ---- UNCHANGED ----
    def __init__(self, notional: float, rate_type: str, frequency: int, fixed_rate: float = 0.0):
        self.notional = notional
        self.rate_type = rate_type.strip().lower()
        self.frequency = frequency
        self.fixed_rate = fixed_rate

    def generate_cashflows(self, curve_builder, trade_date: datetime.date, maturity_date: datetime.date, is_payer: bool) -> List[Dict]:
        schedule = generate_forward_schedule(trade_date, maturity_date, self.frequency)
        cashflows = []
        prev_date = trade_date

        for current_date in schedule:
            amount = 0.0
            tau = calculate_year_fraction(prev_date, current_date, curve_builder.convention)

            if self.rate_type == 'fixed':
                amount = self.notional * self.fixed_rate * tau

            elif self.rate_type in ['float', 'floating']:
                t_prev = calculate_year_fraction(trade_date, prev_date, curve_builder.convention)
                t_curr = calculate_year_fraction(trade_date, current_date, curve_builder.convention)
                df_prev = curve_builder._get_discount_factor(t_prev)
                df_curr = curve_builder._get_discount_factor(t_curr)
                amount = self.notional * ((df_prev / df_curr) - 1.0) if df_curr > 0 else 0.0

            else:
                raise ValueError(f"Unknown rate_type '{self.rate_type}'. Must be 'fixed' or 'float'.")

            direction = -1 if is_payer else 1
            cashflows.append({"date": current_date, "amount": amount * direction})
            prev_date = current_date

        return cashflows


# ============================================================
# REWRITTEN: AssetReturnLeg  ->  Hybrid "Lifetime PnL" model
#
#  The leg now produces a PER-PERIOD cashflow stream over the swap's
#  whole life (inception -> maturity), like a periodically-resetting
#  total-return swap. Each reset period's price return is sourced as:
#
#    * schedule_date <= present_date  -> REALIZED, from historical_prices
#      (the forward-filled fixings dict supplied by the Oracle).
#    * schedule_date >  present_date  -> PROJECTED, forward price off the
#      curve:  F = S * e^((r - q) * t),  S = current_price (spot @ present),
#      t = year-fraction from present_date to the future date, r = the
#      curve's forward rate over [present_date, date], q = dividend yield.
#
#  Schedule starts at the swap's own asset_trade_date (inception), NOT the
#  curve's valuation date, so past resets actually exist on the timeline.
#  Discounting stays in SwapPricer (single source of truth); past dates
#  fall at/under t=0 on the curve and discount at ~1.0 (par), which is the
#  intended treatment for already-realized cashflows.
# ============================================================
class AssetReturnLeg(SwapLeg):
    def __init__(
        self,
        notional: float,
        ticker: str,
        initial_price: float,
        current_price: float,
        dividend_yield: float,
        asset_trade_date: datetime.date,
        present_date: datetime.date,
        tenor_years: int,
        frequency: int,
        historical_prices: dict = None,     # NEW (Phase 1.2): {date: close}
        asset_class: str = "auto",
    ):
        self.notional = notional
        self.ticker = ticker.strip().upper()
        self.initial_price = initial_price
        self.current_price = current_price
        self.dividend_yield = dividend_yield            # q in F = S * e^((r - q) * t)
        self.asset_trade_date = asset_trade_date        # swap inception
        self.present_date = present_date                # realized/projected boundary
        self.tenor_years = tenor_years
        self.frequency = frequency
        self.historical_prices = historical_prices or {}
        self.asset_class = asset_class.strip().lower()

    def _resolve_asset_class(self) -> str:
        """Normalized, validated asset class (typos raise instead of falling through)."""
        ac = self.asset_class
        if ac == "auto":
            return "commodity" if "=" in self.ticker else "equity"
        elif ac in ("equity", "stock"):
            return "equity"
        elif ac in ("commodity", "future", "futures", "fx"):
            return "commodity"
        else:
            raise ValueError(
                f"Unknown asset_class '{self.asset_class}'. Use 'equity', 'commodity', or 'auto'."
            )

    def _fixing_on(self, date: datetime.date) -> float:
        """Realized close on `date` from the (forward-filled) fixings dict, with safe fallbacks."""
        if date in self.historical_prices:
            return self.historical_prices[date]
        prior = [d for d in self.historical_prices if d <= date]
        if prior:
            return self.historical_prices[max(prior)]
        return self.initial_price  # last resort if dict is empty / date precedes all data

    def _price_on(self, date: datetime.date, curve_builder, asset_class: str,
                  t_present: float, df_present: float) -> float:
        """Realized fixing for past dates; curve-projected forward price for future dates."""
        if date <= self.present_date:
            return self._fixing_on(date)

        # ----- forward projection -----
        t_fwd = calculate_year_fraction(self.present_date, date, curve_builder.convention)
        if t_fwd <= 0:
            return self.current_price

        if asset_class == "commodity":
            # No equity-style carry; flat forward off the current spot.
            return self.current_price

        # Equity: curve-consistent forward rate over [present_date, date].
        t_val = calculate_year_fraction(curve_builder.trade_date, date, curve_builder.convention)
        df_date = curve_builder._get_discount_factor(t_val)
        if df_date > 0 and df_present > 0:
            risk_free_fwd = -np.log(df_date / df_present) / t_fwd
        else:
            risk_free_fwd = 0.0

        return self.current_price * np.exp((risk_free_fwd - self.dividend_yield) * t_fwd)

    def generate_cashflows(
        self,
        curve_builder,
        trade_date: datetime.date,      # curve valuation date (unused for schedule start)
        maturity_date: datetime.date,   # curve-relative maturity (unused; recomputed from inception)
        is_payer: bool,
    ) -> List[Dict]:
        asset_class = self._resolve_asset_class()

        # Lifetime schedule: inception -> inception + tenor (independent of the curve date).
        inception = self.asset_trade_date
        maturity = inception + datetime.timedelta(days=self.tenor_years * 365)
        schedule = generate_forward_schedule(inception, maturity, self.frequency)

        # Forward-rate base: curve state at the present date.
        t_present = calculate_year_fraction(curve_builder.trade_date, self.present_date, curve_builder.convention)
        df_present = curve_builder._get_discount_factor(t_present) if t_present > 0 else 1.0

        direction = -1 if is_payer else 1
        cashflows = []

        prev_price = self._price_on(inception, curve_builder, asset_class, t_present, df_present)

        for current_date in schedule:
            price = self._price_on(current_date, curve_builder, asset_class, t_present, df_present)
            period_return = (price / prev_price) - 1.0 if prev_price else 0.0
            cashflows.append({
                "date": current_date,
                "amount": self.notional * period_return * direction,
            })
            prev_price = price

        return cashflows