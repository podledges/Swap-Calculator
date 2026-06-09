import datetime
from typing import List, Dict, Tuple
from quant.day_counter import calculate_year_fraction, generate_forward_schedule

class CurrencySwapPricer:
    def __init__(
        self,
        trade_date: datetime.date,
        maturity_date: datetime.date,
        spot_fx_rate: float,
        leg1_config: dict,
        leg2_config: dict,
        curve_builder1,
        curve_builder2
    ):
        """
        Initializes the Cross-Currency Swap Pricer.
        
        spot_fx_rate: Spot FX rate defined as Leg 1 currency per unit of Leg 2 currency (e.g., USD/EUR = 1.08)
        leg1_config: dict containing notional, rate_type, rate_or_spread, frequency, day_count, is_payer
        leg2_config: dict containing notional, rate_type, rate_or_spread, frequency, day_count, is_payer
        curve_builder1: bootstrapped curve builder for Leg 1's currency
        curve_builder2: bootstrapped curve builder for Leg 2's currency
        """
        self.trade_date = trade_date
        self.maturity_date = maturity_date
        self.spot_fx_rate = spot_fx_rate
        self.leg1 = leg1_config
        self.leg2 = leg2_config
        self.curve1 = curve_builder1
        self.curve2 = curve_builder2

    def generate_leg_interest_cashflows(self, leg: dict, curve_builder) -> List[Dict]:
        """Generates interest cashflows for a single leg in its own currency."""
        notional = float(leg.get('notional', 0.0))
        rate_type = leg.get('rate_type', 'fixed').strip().lower()
        rate_or_spread = float(leg.get('rate_or_spread', 0.0))
        frequency = int(leg.get('frequency', 2))
        day_count = leg.get('day_count', 'ACT/365')
        is_payer = bool(leg.get('is_payer', False))

        schedule = generate_forward_schedule(self.trade_date, self.maturity_date, frequency)
        cashflows = []
        prev_date = self.trade_date

        for current_date in schedule:
            tau = calculate_year_fraction(prev_date, current_date, day_count, frequency)
            if tau <= 0:
                prev_date = current_date
                continue

            if rate_type == 'fixed':
                amount = notional * (rate_or_spread / 100.0) * tau
            elif rate_type in ['float', 'floating']:
                t_prev = calculate_year_fraction(self.trade_date, prev_date, day_count)
                t_curr = calculate_year_fraction(self.trade_date, current_date, day_count)
                df_prev = curve_builder._get_discount_factor(t_prev)
                df_curr = curve_builder._get_discount_factor(t_curr)
                
                # Implied forward rate
                implied_rate = ((df_prev / df_curr) - 1.0) / tau if df_curr > 0 else 0.0
                spread = rate_or_spread / 100.0
                amount = notional * (implied_rate + spread) * tau
            else:
                raise ValueError(f"Unknown rate_type '{rate_type}'")

            # Cash outflows (payments) are negative, inflows (receipts) are positive
            direction = -1 if is_payer else 1
            cashflows.append({
                "date": current_date,
                "amount": amount * direction
            })
            prev_date = current_date

        return cashflows

    def price_swap(self) -> Tuple[List[Dict], Dict]:
        """
        Prices the cross-currency swap.
        Returns the merged cashflow table and a detailed NPV summary.
        """
        # 1. Generate individual interest cashflows
        leg1_cfs = self.generate_leg_interest_cashflows(self.leg1, self.curve1)
        leg2_cfs = self.generate_leg_interest_cashflows(self.leg2, self.curve2)

        # Map cashflows by date
        leg1_map = {cf["date"]: cf["amount"] for cf in leg1_cfs}
        leg2_map = {cf["date"]: cf["amount"] for cf in leg2_cfs}

        # 2. Get unique interest payment dates sorted chronologically
        interest_dates = sorted(list(set(leg1_map.keys()) | set(leg2_map.keys())))

        # PV counters
        leg1_interest_pv = 0.0
        leg2_interest_pv_converted = 0.0
        
        merged_schedule = []

        # 3. Build interest rows
        for d in interest_dates:
            l1_amount = leg1_map.get(d, 0.0)
            l2_amount = leg2_map.get(d, 0.0)

            # Year fractions from trade date
            t_leg1 = calculate_year_fraction(self.trade_date, d, self.leg1['day_count'])
            t_leg2 = calculate_year_fraction(self.trade_date, d, self.leg2['day_count'])

            # Discount factors
            df_leg1 = self.curve1._get_discount_factor(t_leg1)
            df_leg2 = self.curve2._get_discount_factor(t_leg2)

            # FX Forward Rate via Covered Interest Parity (Leg 1 units per unit of Leg 2)
            fx_forward = self.spot_fx_rate * (df_leg2 / df_leg1) if df_leg1 > 0 else self.spot_fx_rate

            # Convert Leg 2 amount to Leg 1 currency
            l2_converted = l2_amount * fx_forward
            net_cf = l1_amount + l2_converted

            # PV of net cashflow using Leg 1 discount factor
            pv_cf = net_cf * df_leg1

            # Accumulate interest PVs
            leg1_interest_pv += l1_amount * df_leg1
            leg2_interest_pv_converted += l2_converted * df_leg1

            merged_schedule.append({
                "date": d.strftime("%Y-%m-%d"),
                "leg1_amount": round(l1_amount, 2),
                "leg2_amount": round(l2_amount, 2),
                "fx_forward": round(fx_forward, 6),
                "leg2_converted": round(l2_converted, 2),
                "net_cashflow": round(net_cf, 2),
                "df": round(df_leg1, 6),
                "pv": round(pv_cf, 2),
                "type": "interest"
            })

        # 4. Generate Notional Exchange at Maturity
        leg1_notional = float(self.leg1.get('notional', 0.0))
        leg2_notional = float(self.leg2.get('notional', 0.0))

        # At maturity, the principal flows have the same direction as interest payments:
        # payer pays principal (negative), receiver receives principal (positive)
        direction1 = -1 if bool(self.leg1.get('is_payer', False)) else 1
        direction2 = -1 if bool(self.leg2.get('is_payer', False)) else 1

        leg1_principal = leg1_notional * direction1
        leg2_principal = leg2_notional * direction2

        t_leg1_mat = calculate_year_fraction(self.trade_date, self.maturity_date, self.leg1['day_count'])
        t_leg2_mat = calculate_year_fraction(self.trade_date, self.maturity_date, self.leg2['day_count'])

        df_leg1_mat = self.curve1._get_discount_factor(t_leg1_mat)
        df_leg2_mat = self.curve2._get_discount_factor(t_leg2_mat)

        fx_forward_mat = self.spot_fx_rate * (df_leg2_mat / df_leg1_mat) if df_leg1_mat > 0 else self.spot_fx_rate

        leg2_principal_converted = leg2_principal * fx_forward_mat
        net_principal = leg1_principal + leg2_principal_converted
        pv_principal = net_principal * df_leg1_mat

        # Accumulate principal PVs
        leg1_notional_pv = leg1_principal * df_leg1_mat
        leg2_notional_pv_converted = leg2_principal_converted * df_leg1_mat

        merged_schedule.append({
            "date": self.maturity_date.strftime("%Y-%m-%d"),
            "leg1_amount": round(leg1_principal, 2),
            "leg2_amount": round(leg2_principal, 2),
            "fx_forward": round(fx_forward_mat, 6),
            "leg2_converted": round(leg2_principal_converted, 2),
            "net_cashflow": round(net_principal, 2),
            "df": round(df_leg1_mat, 6),
            "pv": round(pv_principal, 2),
            "type": "principal"
        })

        # Calculate totals
        leg1_total_pv = leg1_interest_pv + leg1_notional_pv
        leg2_total_pv = leg2_interest_pv_converted + leg2_notional_pv_converted
        total_net_npv = leg1_total_pv + leg2_total_pv

        npv_summary = {
            "leg1_interest_pv": round(leg1_interest_pv, 2),
            "leg1_notional_pv": round(leg1_notional_pv, 2),
            "leg1_total_pv": round(leg1_total_pv, 2),
            "leg2_interest_pv": round(leg2_interest_pv_converted, 2),
            "leg2_notional_pv": round(leg2_notional_pv_converted, 2),
            "leg2_total_pv": round(leg2_total_pv, 2),
            "total_net_npv": round(total_net_npv, 2)
        }

        return merged_schedule, npv_summary
