# src/data/market_data.py
import yfinance as yf
import datetime


class AssetPriceOracle:

    @staticmethod
    def get_dividend_yield(ticker: str) -> float:
        """Fetches the annualized dividend yield. Returns 0.0 for commodities/missing data."""
        stock = yf.Ticker(ticker.strip().upper())
        try:
            div_yield = stock.info.get('dividendYield', 0.0)
            return float(div_yield) if div_yield is not None else 0.0
        except Exception:
            return 0.0

    @staticmethod
    def get_latest_price(ticker: str) -> float:
        stock = yf.Ticker(ticker.strip().upper())
        hist = stock.history(period="5d")
        if hist.empty:
            raise ValueError(f"Could not fetch live data for ticker: {ticker}")
        return float(hist['Close'].iloc[-1])  # iloc[-1] = most recent close

    # ============================================================
    # NEW: backward-walking price fetch (Phase 2 requirement)
    # Cleanly handles weekends, market holidays, and pre/post-market
    # by pulling a window that ENDS at `as_of_date` and taking the
    # last available close on or before that date. yfinance only
    # returns rows for valid trading sessions, so "walking backward"
    # is implicit in taking the final row of the window.
    # ============================================================
    @staticmethod
    def get_most_recent_price(ticker: str, as_of_date_str: str, lookback_days: int = 10) -> float:
        """
        Returns the most recent valid closing price on or before `as_of_date_str`.

        as_of_date_str format: 'YYYY-MM-DD'
        lookback_days: how far back to search for the nearest open session
                       (10 calendar days comfortably covers long holiday weekends).
        """
        ticker_clean = ticker.strip().upper()
        as_of = datetime.date.fromisoformat(as_of_date_str)

        # yfinance `end` is exclusive, so push it one day past as_of to include it.
        start = (as_of - datetime.timedelta(days=lookback_days)).isoformat()
        end = (as_of + datetime.timedelta(days=1)).isoformat()

        stock = yf.Ticker(ticker_clean)
        hist = stock.history(start=start, end=end)

        if hist.empty:
            # Widen the window once before giving up (handles very long gaps).
            start = (as_of - datetime.timedelta(days=lookback_days * 3)).isoformat()
            hist = stock.history(start=start, end=end)
            if hist.empty:
                raise ValueError(
                    f"No price data found for {ticker_clean} on or before {as_of_date_str}"
                )

        # Last row of the window == nearest valid close at-or-before as_of.
        return float(hist['Close'].iloc[-1])

    # ============================================================
    # NEW (Phase 1.1): one-shot historical fixings for Lifetime PnL.
    # Downloads the [start, end] window ONCE and returns a dense,
    # forward-filled {datetime.date: close} lookup so the leg can ask
    # for the price on ANY calendar date (incl. weekends/holidays)
    # without a per-date network call and without KeyErrors.
    # ============================================================
    @staticmethod
    def get_historical_fixings(ticker: str, start_date: datetime.date, end_date: datetime.date) -> dict:
        """
        Returns {datetime.date: closing_price} for every calendar day in
        [start_date, end_date], forward-filled from the most recent valid
        trading close on or before each day.

        start_date / end_date: datetime.date objects.
        """
        ticker_clean = ticker.strip().upper()

        # Seed the window a little earlier so the first requested day can
        # back-reference a real close if it lands on a weekend/holiday.
        buffer_start = start_date - datetime.timedelta(days=7)
        stock = yf.Ticker(ticker_clean)
        hist = stock.history(
            start=buffer_start.isoformat(),
            end=(end_date + datetime.timedelta(days=1)).isoformat(),  # yfinance end is exclusive
        )
        if hist.empty:
            raise ValueError(
                f"No historical fixings for {ticker_clean} between {start_date} and {end_date}"
            )

        # Map each trading session's date -> close.
        price_by_date = {ts.date(): float(close) for ts, close in hist['Close'].items()}
        if not price_by_date:
            raise ValueError(f"No closing prices parsed for {ticker_clean}")

        # Forward-fill across the full calendar range. Seed with the earliest
        # known close so any pre-first-session days still resolve (back-fill).
        last_price = price_by_date[min(price_by_date)]
        fixings = {}
        cursor = start_date
        while cursor <= end_date:
            if cursor in price_by_date:
                last_price = price_by_date[cursor]
            fixings[cursor] = last_price
            cursor += datetime.timedelta(days=1)

        return fixings

    @staticmethod
    def get_historical_price(ticker: str, date_str: str) -> float:
        """
        Fetches the closing price on or after a specific date.
        Starts one day earlier to handle pre-market / market-closed scenarios.
        date_str format: 'YYYY-MM-DD'
        """
        stock = yf.Ticker(ticker.strip().upper())
        start = (datetime.date.fromisoformat(date_str) - datetime.timedelta(days=1)).isoformat()
        hist = stock.history(start=start)
        if hist.empty:
            raise ValueError(f"No price data found for {ticker} around {date_str}")
        return float(hist['Close'].iloc[0])

    @staticmethod
    def get_asset_info(ticker: str, trade_date_str: str = None, present_date_str: str = None) -> dict:
        """
        Aggregates initial price, current price, and dividend yield for an asset.

        initial_price : nearest valid close on/before `trade_date_str`.
        current_price : nearest valid close on/before `present_date_str`
                        (falls back to the latest available close if omitted).

        trade_date_str / present_date_str format: 'YYYY-MM-DD'
        """
        ticker_clean = ticker.strip().upper()

        # --- MODIFIED: route both prices through get_most_recent_price -------
        if present_date_str:
            current_price = AssetPriceOracle.get_most_recent_price(ticker_clean, present_date_str)
        else:
            current_price = AssetPriceOracle.get_latest_price(ticker_clean)

        div_yield = AssetPriceOracle.get_dividend_yield(ticker_clean)

        initial_price = (
            AssetPriceOracle.get_most_recent_price(ticker_clean, trade_date_str)
            if trade_date_str
            else current_price
        )
        # --------------------------------------------------------------------

        return {
            "ticker": ticker_clean,
            "initial_price": initial_price,
            "current_price": current_price,
            "dividend_yield": div_yield,
        }