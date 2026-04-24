"""
Signal generator — combines RSI, MACD, and Bollinger Band readings into
a single BUY / SELL / NEUTRAL call with a 0-100 confidence score,
plus entry / stop-loss / target levels for the retail trader.
"""

from datetime import datetime, timezone
import math
import pandas as pd


def _safe(v: float, default: float = 0.0) -> float:
    try:
        f = float(v)
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default

from app.core.config import settings
from app.models.schemas import CallResponse, IndicatorSignal, IndicatorSnapshot
from app.services import indicators as ind
from app.services.nse_client import fetch_ohlcv, fetch_live_quote, get_stock_name


# ─────────────────────────────────────────────────────────────────────────────
# Internal scoring helpers
# ─────────────────────────────────────────────────────────────────────────────

def _score_rsi(rsi_val: float) -> tuple[str, float, str]:
    """Return (signal, score[-2..+2], reason)."""
    if rsi_val < 25:
        return "BUY", 2.0, f"RSI {rsi_val:.1f} — deeply oversold, strong reversal zone"
    if rsi_val < 35:
        return "BUY", 1.0, f"RSI {rsi_val:.1f} — oversold, potential bounce ahead"
    if rsi_val > 75:
        return "SELL", -2.0, f"RSI {rsi_val:.1f} — deeply overbought, profit-booking expected"
    if rsi_val > 65:
        return "SELL", -1.0, f"RSI {rsi_val:.1f} — overbought, watch for reversal"
    return "NEUTRAL", 0.0, f"RSI {rsi_val:.1f} — neutral zone (35-65), no directional bias"


def _score_macd(hist: float, prev_hist: float, macd_val: float) -> tuple[str, float, str]:
    """Return (signal, score[-2..+2], reason)."""
    # Crossover events get max score
    if prev_hist <= 0 and hist > 0:
        return "BUY", 2.0, "MACD histogram turned positive — fresh bullish crossover"
    if prev_hist >= 0 and hist < 0:
        return "SELL", -2.0, "MACD histogram turned negative — fresh bearish crossover"
    # Trend confirmation
    if hist > 0:
        return "BUY", 1.0, f"MACD histogram positive ({hist:.2f}) — upward momentum intact"
    if hist < 0:
        return "SELL", -1.0, f"MACD histogram negative ({hist:.2f}) — downward momentum intact"
    return "NEUTRAL", 0.0, "MACD histogram near zero — momentum indecisive"


def _score_bb(close: float, upper: float, lower: float, middle: float) -> tuple[str, float, str]:
    """Return (signal, score[-2..+2], reason)."""
    band_width = upper - lower
    if band_width == 0:
        return "NEUTRAL", 0.0, "Bollinger Bands collapsed — very low volatility"

    position = (close - lower) / band_width * 100  # 0=lower, 100=upper

    if close < lower:
        return "BUY", 2.0, f"Price below lower BB (₹{lower:.2f}) — oversold breakout watch"
    if position <= 25:
        return "BUY", 1.0, f"Price in lower BB quartile ({position:.0f}%) — support zone"
    if close > upper:
        return "SELL", -2.0, f"Price above upper BB (₹{upper:.2f}) — overbought, mean-reversion risk"
    if position >= 75:
        return "SELL", -1.0, f"Price in upper BB quartile ({position:.0f}%) — resistance zone"
    return "NEUTRAL", 0.0, f"Price mid-BB ({position:.0f}%) — no edge from Bollinger Bands"


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def generate_call(symbol: str) -> CallResponse:
    """
    Fetch OHLCV data for `symbol`, calculate indicators, and return a
    fully-formed CallResponse with BUY/SELL/NEUTRAL + confidence score.
    """
    symbol = symbol.upper()

    # ── 1. Data ──────────────────────────────────────────────────────────────
    df = fetch_ohlcv(symbol, period=settings.ohlcv_period)
    close = df["Close"]

    if len(close) < settings.macd_slow + settings.macd_signal + 5:
        raise ValueError(f"Not enough history for '{symbol}' to compute indicators.")

    # ── 2. Indicators ────────────────────────────────────────────────────────
    rsi_series = ind.rsi(close, settings.rsi_period)
    macd_line, sig_line, histogram = ind.macd(
        close, settings.macd_fast, settings.macd_slow, settings.macd_signal
    )
    bb_upper, bb_middle, bb_lower = ind.bollinger_bands(
        close, settings.bb_period, settings.bb_std_dev
    )
    ema20 = ind.ema(close, 20)
    ema50 = ind.ema(close, 50)

    # Latest values — _safe() converts NaN/Inf so JSON serialization never fails
    rsi_val  = _safe(rsi_series.iloc[-1])
    macd_val = _safe(macd_line.iloc[-1])
    sig_val  = _safe(sig_line.iloc[-1])
    hist_val = _safe(histogram.iloc[-1])
    prev_hist = _safe(histogram.iloc[-2])
    cur_price = _safe(close.iloc[-1])
    up_val    = _safe(bb_upper.iloc[-1])
    mid_val   = _safe(bb_middle.iloc[-1])
    lo_val    = _safe(bb_lower.iloc[-1])
    e20_val   = _safe(ema20.iloc[-1])
    e50_val   = _safe(ema50.iloc[-1])

    band_width = up_val - lo_val
    bb_pos = (cur_price - lo_val) / band_width * 100 if band_width else 50.0

    # ── 3. Score each indicator ──────────────────────────────────────────────
    rsi_sig,  rsi_score,  rsi_reason  = _score_rsi(rsi_val)
    macd_sig, macd_score, macd_reason = _score_macd(hist_val, prev_hist, macd_val)
    bb_sig,   bb_score,   bb_reason   = _score_bb(cur_price, up_val, lo_val, mid_val)

    signals = [
        IndicatorSignal(indicator="RSI",  signal=rsi_sig,  raw_value=round(rsi_val, 2),
                        weight=1.0, reason=rsi_reason),
        IndicatorSignal(indicator="MACD", signal=macd_sig, raw_value=round(macd_val, 4),
                        weight=1.0, reason=macd_reason),
        IndicatorSignal(indicator="BB",   signal=bb_sig,   raw_value=round(bb_pos, 2),
                        weight=1.0, reason=bb_reason),
    ]

    # ── 4. Aggregate into a single call ──────────────────────────────────────
    total_score = rsi_score + macd_score + bb_score  # range: -6 to +6

    if total_score > 0.5:
        call = "BUY"
        confidence = 50 + (total_score / 6) * 45          # 50-95%
    elif total_score < -0.5:
        call = "SELL"
        confidence = 50 + (abs(total_score) / 6) * 45
    else:
        call = "NEUTRAL"
        confidence = 50 - abs(total_score) * 3            # 47-50%

    confidence = round(min(max(confidence, 35.0), 95.0), 1)

    # ── 5. Entry / stop-loss / target ────────────────────────────────────────
    risk_amt = cur_price * settings.risk_pct

    if call == "BUY":
        entry     = cur_price
        stop_loss = round(entry - risk_amt, 2)
        target    = round(entry + 2 * risk_amt, 2)
    elif call == "SELL":
        entry     = cur_price
        stop_loss = round(entry + risk_amt, 2)
        target    = round(entry - 2 * risk_amt, 2)
    else:
        entry     = cur_price
        stop_loss = round(cur_price - risk_amt, 2)
        target    = round(cur_price + risk_amt, 2)

    # ── 6. Assemble response ─────────────────────────────────────────────────
    return CallResponse(
        symbol=symbol,
        name=get_stock_name(symbol),
        exchange="NSE",
        call=call,
        confidence=confidence,
        current_price=round(cur_price, 2),
        entry=round(entry, 2),
        stop_loss=stop_loss,
        target=target,
        risk_reward="1:2",
        validity="3-5 trading days",
        signals=signals,
        indicators=IndicatorSnapshot(
            rsi=round(rsi_val, 2),
            macd=round(macd_val, 4),
            macd_signal=round(sig_val, 4),
            macd_histogram=round(hist_val, 4),
            bb_upper=round(up_val, 2),
            bb_middle=round(mid_val, 2),
            bb_lower=round(lo_val, 2),
            bb_position=round(bb_pos, 2),
            ema_20=round(e20_val, 2),
            ema_50=round(e50_val, 2),
        ),
        generated_at=datetime.now(timezone.utc),
    )
