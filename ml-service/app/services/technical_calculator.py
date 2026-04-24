"""
Technical signal calculator.

Computes RSI, MACD, Bollinger Bands, VWAP, EMA(9), EMA(21), support/resistance,
and a volume anomaly flag from real OHLCV data fetched via yfinance.

technical_score (0-100):
  0–30   : strongly bearish
  31–45  : mildly bearish
  46–54  : neutral
  55–69  : mildly bullish
  70–100 : strongly bullish
"""

from datetime import datetime, timezone
import math
import pandas as pd

from app.core.config import settings
from app.models.schemas import TechnicalSignalResponse
from app.services import indicators as ind
from app.services.nse_client import fetch_ohlcv


def _safe(v: float, default: float = 0.0) -> float:
    """Replace NaN / Inf with default so JSON serialization never fails."""
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def _rsi_score(rsi_val: float) -> float:
    if rsi_val <= 20:   return  1.0
    if rsi_val <= 30:   return  0.75
    if rsi_val <= 40:   return  0.35
    if rsi_val >= 80:   return -1.0
    if rsi_val >= 70:   return -0.75
    if rsi_val >= 60:   return -0.35
    return (50 - rsi_val) / 50 * 0.35


def _macd_score(macd_val: float, macd_sig: float, hist: float, prev_hist: float) -> float:
    if prev_hist <= 0 and hist > 0:   return  1.0
    if prev_hist >= 0 and hist < 0:   return -1.0
    if hist > 0:
        return min(0.6, 0.3 + abs(macd_val - macd_sig) / (abs(macd_val) + 1e-9) * 0.3)
    if hist < 0:
        return max(-0.6, -(0.3 + abs(macd_val - macd_sig) / (abs(macd_val) + 1e-9) * 0.3))
    return 0.0


def _bb_score(close: float, upper: float, lower: float) -> float:
    band_width = upper - lower
    if band_width == 0:
        return 0.0
    pos = (close - lower) / band_width
    if close < lower:   return  1.0
    if close > upper:   return -1.0
    return (0.5 - pos) * 1.4


def _vwap_score(close: float, vwap_val: float) -> float:
    if vwap_val == 0:
        return 0.0
    deviation_pct = (close - vwap_val) / vwap_val
    return max(-0.5, min(0.5, -deviation_pct / 0.02 * 0.5))


def _ema_cross_score(ema9_val: float, ema21_val: float) -> float:
    if ema21_val == 0:
        return 0.0
    gap_pct = (ema9_val - ema21_val) / ema21_val
    return max(-0.6, min(0.6, gap_pct / 0.005 * 0.6))


_WEIGHTS = {
    "rsi":      0.25,
    "macd":     0.25,
    "bb":       0.20,
    "vwap":     0.15,
    "ema_cross":0.15,
}


def _aggregate_score(rsi_s, macd_s, bb_s, vwap_s, ema_s, vol_ratio):
    raw = (
        rsi_s  * _WEIGHTS["rsi"]       +
        macd_s * _WEIGHTS["macd"]      +
        bb_s   * _WEIGHTS["bb"]        +
        vwap_s * _WEIGHTS["vwap"]      +
        ema_s  * _WEIGHTS["ema_cross"]
    )
    score = 50 + raw * 50
    if vol_ratio > 2.0:
        amplifier = min((vol_ratio - 2.0) * 5.0, 10.0)
        if raw > 0:
            score = min(100.0, score + amplifier)
        elif raw < 0:
            score = max(0.0, score - amplifier)
    return round(min(100.0, max(0.0, score)), 1)


def compute_technical_signals(symbol: str) -> TechnicalSignalResponse:
    symbol = symbol.upper()
    df = fetch_ohlcv(symbol, period=settings.ohlcv_period)

    min_bars = max(settings.macd_slow + settings.macd_signal + 5, 26)
    if len(df) < min_bars:
        raise ValueError(f"'{symbol}' has only {len(df)} bars — need {min_bars}.")

    close   = df["Close"]
    high    = df["High"]
    low     = df["Low"]
    volume  = df["Volume"]

    rsi_series   = ind.rsi(close, settings.rsi_period)
    macd_line, sig_line, histogram = ind.macd(
        close, settings.macd_fast, settings.macd_slow, settings.macd_signal
    )
    bb_upper_s, bb_mid_s, bb_lower_s = ind.bollinger_bands(close, settings.bb_period, settings.bb_std_dev)
    vwap_series  = ind.vwap(df, period=settings.bb_period)
    ema9_series  = ind.ema(close, 9)
    ema21_series = ind.ema(close, 21)
    vol_ratio_s  = ind.volume_ratio(volume, period=20)

    rsi_val    = _safe(rsi_series.iloc[-1])
    macd_val   = _safe(macd_line.iloc[-1])
    sig_val    = _safe(sig_line.iloc[-1])
    hist_val   = _safe(histogram.iloc[-1])
    prev_hist  = _safe(histogram.iloc[-2])
    bb_up      = _safe(bb_upper_s.iloc[-1])
    bb_mid     = _safe(bb_mid_s.iloc[-1])
    bb_lo      = _safe(bb_lower_s.iloc[-1])
    vwap_val   = _safe(vwap_series.iloc[-1])
    ema9_val   = _safe(ema9_series.iloc[-1])
    ema21_val  = _safe(ema21_series.iloc[-1])
    cur_close  = _safe(close.iloc[-1])
    prev_close = _safe(close.iloc[-2]) if len(close) > 1 else cur_close
    cur_vol    = int(volume.iloc[-1]) if not pd.isna(volume.iloc[-1]) else 0
    vol_ratio_val = _safe(vol_ratio_s.iloc[-1], default=1.0)

    band_width = bb_up - bb_lo
    bb_pos = (cur_close - bb_lo) / band_width * 100 if band_width else 50.0

    change_pct = round((cur_close - prev_close) / prev_close * 100, 2) if prev_close else 0.0

    # Support = 20-bar low of lows; Resistance = 20-bar high of highs
    lookback = min(20, len(df))
    support    = round(float(low.iloc[-lookback:].min()), 2)
    resistance = round(float(high.iloc[-lookback:].max()), 2)

    rsi_s  = _rsi_score(rsi_val)
    macd_s = _macd_score(macd_val, sig_val, hist_val, prev_hist)
    bb_s   = _bb_score(cur_close, bb_up, bb_lo)
    vwap_s = _vwap_score(cur_close, vwap_val)
    ema_s  = _ema_cross_score(ema9_val, ema21_val)

    tech_score = _aggregate_score(rsi_s, macd_s, bb_s, vwap_s, ema_s, vol_ratio_val)

    return TechnicalSignalResponse(
        symbol=symbol,
        timestamp=datetime.now(timezone.utc),
        current_price=round(cur_close, 2),
        change_pct=change_pct,
        rsi=round(rsi_val, 2),
        macd=round(macd_val, 4),
        macd_signal=round(sig_val, 4),
        macd_hist=round(hist_val, 4),
        bb_upper=round(bb_up, 2),
        bb_lower=round(bb_lo, 2),
        bb_mid=round(bb_mid, 2),
        bb_position=round(bb_pos, 2),
        vwap=round(vwap_val, 2),
        ema9=round(ema9_val, 2),
        ema21=round(ema21_val, 2),
        volume=cur_vol,
        volume_ratio=round(vol_ratio_val, 3),
        volume_anomaly=vol_ratio_val > 2.0,
        support=support,
        resistance=resistance,
        technical_score=tech_score,
    )
