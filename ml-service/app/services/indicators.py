"""
Technical indicator calculations — pure NumPy/Pandas, no external TA library.
All functions operate on a pd.Series of closing prices unless noted.
"""

import numpy as np
import pandas as pd


# ─────────────────────────────────────────────────────────────────────────────
# RSI  (Wilder smoothing, industry standard)
# ─────────────────────────────────────────────────────────────────────────────

def rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    # Wilder smoothing = exponential with alpha = 1/period
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


# ─────────────────────────────────────────────────────────────────────────────
# MACD
# ─────────────────────────────────────────────────────────────────────────────

def macd(
    prices: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (macd_line, signal_line, histogram)."""
    ema_fast = prices.ewm(span=fast, adjust=False).mean()
    ema_slow = prices.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# ─────────────────────────────────────────────────────────────────────────────
# Bollinger Bands
# ─────────────────────────────────────────────────────────────────────────────

def bollinger_bands(
    prices: pd.Series,
    period: int = 20,
    std_dev: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (upper, middle/SMA, lower)."""
    sma = prices.rolling(window=period).mean()
    std = prices.rolling(window=period).std(ddof=0)
    return sma + std_dev * std, sma, sma - std_dev * std


# ─────────────────────────────────────────────────────────────────────────────
# EMA  (used for trend context; call with period=9 or period=21 for Chunk 2)
# ─────────────────────────────────────────────────────────────────────────────

def ema(prices: pd.Series, period: int) -> pd.Series:
    return prices.ewm(span=period, adjust=False).mean()


# ─────────────────────────────────────────────────────────────────────────────
# VWAP  (rolling N-period volume-weighted average price)
# Requires a DataFrame with Close, High, Low, Volume columns.
# For daily bars a 20-session rolling VWAP is the standard institutional reference.
# ─────────────────────────────────────────────────────────────────────────────

def vwap(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """
    Rolling VWAP over `period` bars.
    df must have columns: High, Low, Close, Volume.
    Returns a Series aligned to df's index.
    """
    typical = (df["High"] + df["Low"] + df["Close"]) / 3
    tpv = typical * df["Volume"]
    rolling_tpv = tpv.rolling(window=period).sum()
    rolling_vol = df["Volume"].rolling(window=period).sum()
    return rolling_tpv / rolling_vol.replace(0, np.nan)


# ─────────────────────────────────────────────────────────────────────────────
# Volume ratio  (current volume vs N-day average — anomaly detector)
# ─────────────────────────────────────────────────────────────────────────────

def volume_ratio(volumes: pd.Series, period: int = 20) -> pd.Series:
    """
    Returns current_volume / rolling_mean_volume for each bar.
    A ratio > 2.0 flags a volume anomaly (spike).
    """
    avg = volumes.rolling(window=period).mean()
    return volumes / avg.replace(0, np.nan)
