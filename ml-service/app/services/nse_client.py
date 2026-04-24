"""
NSE data client — wraps yfinance with .NS suffix.
yfinance returns near-real-time quotes (~15 min delay, same as NSE public feed).
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timezone

NIFTY50_NAMES: dict[str, str] = {
    "ADANIENT":   "Adani Enterprises Ltd",
    "ADANIPORTS":  "Adani Ports & SEZ Ltd",
    "APOLLOHOSP":  "Apollo Hospitals Enterprise Ltd",
    "ASIANPAINT":  "Asian Paints Ltd",
    "AXISBANK":    "Axis Bank Ltd",
    "BAJAJ-AUTO":  "Bajaj Auto Ltd",
    "BAJFINANCE":  "Bajaj Finance Ltd",
    "BAJAJFINSV":  "Bajaj Finserv Ltd",
    "BEL":         "Bharat Electronics Ltd",
    "BPCL":        "Bharat Petroleum Corp Ltd",
    "BHARTIARTL":  "Bharti Airtel Ltd",
    "BRITANNIA":   "Britannia Industries Ltd",
    "CIPLA":       "Cipla Ltd",
    "COALINDIA":   "Coal India Ltd",
    "DRREDDY":     "Dr. Reddy's Laboratories Ltd",
    "EICHERMOT":   "Eicher Motors Ltd",
    "ETERNAL":     "Eternal Ltd",
    "GRASIM":      "Grasim Industries Ltd",
    "HCLTECH":     "HCL Technologies Ltd",
    "HDFCBANK":    "HDFC Bank Ltd",
    "HDFCLIFE":    "HDFC Life Insurance Co Ltd",
    "HEROMOTOCO":  "Hero MotoCorp Ltd",
    "HINDALCO":    "Hindalco Industries Ltd",
    "HINDUNILVR":  "Hindustan Unilever Ltd",
    "ICICIBANK":   "ICICI Bank Ltd",
    "ITC":         "ITC Ltd",
    "INDUSINDBK":  "IndusInd Bank Ltd",
    "INFY":        "Infosys Ltd",
    "JSWSTEEL":    "JSW Steel Ltd",
    "KOTAKBANK":   "Kotak Mahindra Bank Ltd",
    "LT":          "Larsen & Toubro Ltd",
    "LICI":        "Life Insurance Corporation of India",
    "M&M":         "Mahindra & Mahindra Ltd",
    "MARUTI":      "Maruti Suzuki India Ltd",
    "NESTLEIND":   "Nestle India Ltd",
    "NTPC":        "NTPC Ltd",
    "ONGC":        "Oil & Natural Gas Corp Ltd",
    "POWERGRID":   "Power Grid Corp of India Ltd",
    "RELIANCE":    "Reliance Industries Ltd",
    "SBILIFE":     "SBI Life Insurance Co Ltd",
    "SHRIRAMFIN":  "Shriram Finance Ltd",
    "SBIN":        "State Bank of India",
    "SUNPHARMA":   "Sun Pharmaceutical Industries Ltd",
    "TCS":         "Tata Consultancy Services Ltd",
    "TATACONSUM":  "Tata Consumer Products Ltd",
    "TATAMOTORS":  "Tata Motors Ltd",
    "TATASTEEL":   "Tata Steel Ltd",
    "TECHM":       "Tech Mahindra Ltd",
    "TITAN":        "Titan Company Ltd",
    "TRENT":       "Trent Ltd",
    "ULTRACEMCO":  "UltraTech Cement Ltd",
    "WIPRO":       "Wipro Ltd",
}

NIFTY50_SYMBOLS: list[str] = sorted(NIFTY50_NAMES.keys())

SECTOR_MAP: dict[str, str] = {
    "ADANIENT":   "Conglomerates",
    "ADANIPORTS":  "Infrastructure",
    "APOLLOHOSP":  "Healthcare",
    "ASIANPAINT":  "FMCG",
    "AXISBANK":    "Banking",
    "BAJAJ-AUTO":  "Automobiles",
    "BAJFINANCE":  "Finance",
    "BAJAJFINSV":  "Finance",
    "BEL":         "Defence",
    "BPCL":        "Energy",
    "BHARTIARTL":  "Telecom",
    "BRITANNIA":   "FMCG",
    "CIPLA":       "Pharma",
    "COALINDIA":   "Mining",
    "DRREDDY":     "Pharma",
    "EICHERMOT":   "Automobiles",
    "ETERNAL":     "Consumer",
    "GRASIM":      "Conglomerates",
    "HCLTECH":     "Information Tech",
    "HDFCBANK":    "Banking",
    "HDFCLIFE":    "Insurance",
    "HEROMOTOCO":  "Automobiles",
    "HINDALCO":    "Metals",
    "HINDUNILVR":  "FMCG",
    "ICICIBANK":   "Banking",
    "ITC":         "FMCG",
    "INDUSINDBK":  "Banking",
    "INFY":        "Information Tech",
    "JSWSTEEL":    "Metals",
    "KOTAKBANK":   "Banking",
    "LT":          "Infrastructure",
    "LICI":        "Insurance",
    "M&M":         "Automobiles",
    "MARUTI":      "Automobiles",
    "NESTLEIND":   "FMCG",
    "NTPC":        "Energy",
    "ONGC":        "Energy",
    "POWERGRID":   "Energy",
    "RELIANCE":    "Energy",
    "SBILIFE":     "Insurance",
    "SHRIRAMFIN":  "Finance",
    "SBIN":        "Banking",
    "SUNPHARMA":   "Pharma",
    "TCS":         "Information Tech",
    "TATACONSUM":  "FMCG",
    "TATAMOTORS":  "Automobiles",
    "TATASTEEL":   "Metals",
    "TECHM":       "Information Tech",
    "TITAN":        "Consumer",
    "TRENT":       "Consumer",
    "ULTRACEMCO":  "Cement",
    "WIPRO":       "Information Tech",
}


def _ticker(symbol: str) -> yf.Ticker:
    return yf.Ticker(f"{symbol.upper()}.NS")


def fetch_ohlcv(symbol: str, period: str = "6mo") -> pd.DataFrame:
    df = _ticker(symbol).history(period=period, auto_adjust=True)
    if df.empty:
        raise ValueError(f"No OHLCV data found for '{symbol}' on NSE.")
    # Drop rows where Close is NaN (e.g., today's incomplete candle outside market hours)
    df = df.dropna(subset=["Close"])
    if df.empty:
        raise ValueError(f"No valid OHLCV data for '{symbol}' after dropping NaN rows.")
    return df[["Open", "High", "Low", "Close", "Volume"]].copy()


def fetch_live_quote(symbol: str) -> dict:
    """Return the latest price, OHLC, volume, and change for an NSE symbol."""
    t = _ticker(symbol)
    df = t.history(period="5d", auto_adjust=True)
    if df.empty:
        raise ValueError(f"Cannot fetch quote for '{symbol}'.")

    df = df.dropna(subset=["Close"])
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else df.iloc[-1]

    ltp = round(float(latest["Close"]), 2)
    prev_close = round(float(prev["Close"]), 2)
    change = round(ltp - prev_close, 2)
    change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0

    return {
        "symbol": symbol.upper(),
        "name": NIFTY50_NAMES.get(symbol.upper(), symbol.upper()),
        "ltp": ltp,
        "open": round(float(latest["Open"]), 2),
        "high": round(float(latest["High"]), 2),
        "low": round(float(latest["Low"]), 2),
        "close": prev_close,
        "volume": int(latest["Volume"]),
        "change": change,
        "change_pct": change_pct,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        # Legacy key for backward compat
        "price": ltp,
    }


def fetch_index_quote(index_symbol: str, display_name: str) -> dict:
    """Fetch quote for a market index (e.g., ^NSEI, ^NSEBANK)."""
    t = yf.Ticker(index_symbol)
    df = t.history(period="5d", auto_adjust=True)
    if df.empty:
        raise ValueError(f"No data for index '{index_symbol}'.")

    df = df.dropna(subset=["Close"])
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else df.iloc[-1]

    ltp = round(float(latest["Close"]), 2)
    prev_close = round(float(prev["Close"]), 2)
    change = round(ltp - prev_close, 2)
    change_pct = round(change / prev_close * 100, 2) if prev_close else 0.0

    return {
        "symbol": display_name,
        "name": display_name,
        "ltp": ltp,
        "change": change,
        "change_pct": change_pct,
    }


def get_stock_name(symbol: str) -> str:
    return NIFTY50_NAMES.get(symbol.upper(), symbol.upper())
