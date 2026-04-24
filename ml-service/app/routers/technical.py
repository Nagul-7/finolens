"""
Technical signal endpoints.

GET /technical/supertrend/{symbol}  — SuperTrend indicator (period=10, mult=3)
GET /technical/{symbol}             — Full technical snapshot
GET /technical/batch/all            — Batch for multiple symbols
"""

import asyncio
import math
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import TechnicalSignalResponse
from app.services.technical_calculator import compute_technical_signals
from app.services.nse_client import NIFTY50_SYMBOLS, fetch_ohlcv
import redis as _redis
from app.core.config import settings

router = APIRouter(prefix="/technical", tags=["technical-signals"])

_cache: _redis.Redis | None = None


# ─────────────────────────────────────────────────────────────────────────────
# SuperTrend helper
# ─────────────────────────────────────────────────────────────────────────────

def _compute_supertrend(df: pd.DataFrame, period: int = 10, multiplier: float = 3.0) -> dict:
    high  = df["High"]
    low   = df["Low"]
    close = df["Close"]

    # True Range
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1.0 / period, adjust=False).mean()

    hl2 = (high + low) / 2
    basic_upper = hl2 + multiplier * atr
    basic_lower = hl2 - multiplier * atr

    # Iteratively compute final bands and SuperTrend
    final_upper = basic_upper.copy()
    final_lower = basic_lower.copy()
    supertrend  = pd.Series(np.nan, index=close.index)

    for i in range(1, len(close)):
        # Upper band: carry forward unless a new lower value appears
        prev_up = final_upper.iloc[i - 1]
        final_upper.iloc[i] = (
            basic_upper.iloc[i]
            if basic_upper.iloc[i] < prev_up or close.iloc[i - 1] > prev_up
            else prev_up
        )
        # Lower band: carry forward unless a new higher value appears
        prev_lo = final_lower.iloc[i - 1]
        final_lower.iloc[i] = (
            basic_lower.iloc[i]
            if basic_lower.iloc[i] > prev_lo or close.iloc[i - 1] < prev_lo
            else prev_lo
        )

    # Set SuperTrend values
    supertrend.iloc[0] = final_upper.iloc[0]
    for i in range(1, len(close)):
        prev_st = supertrend.iloc[i - 1]
        if prev_st == final_upper.iloc[i - 1]:
            supertrend.iloc[i] = final_lower.iloc[i] if close.iloc[i] > final_upper.iloc[i] else final_upper.iloc[i]
        else:
            supertrend.iloc[i] = final_upper.iloc[i] if close.iloc[i] < final_lower.iloc[i] else final_lower.iloc[i]

    last_close = float(close.iloc[-1])
    st_val     = float(supertrend.iloc[-1])
    trend      = "LONG" if last_close > st_val else "SHORT"

    # Crossover: look at previous bar's relationship
    if len(supertrend) >= 2:
        prev_close_val = float(close.iloc[-2])
        prev_st_val    = float(supertrend.iloc[-2])
        prev_trend     = "LONG" if prev_close_val > prev_st_val else "SHORT"
    else:
        prev_trend = trend

    return {
        "supertrend_value": round(st_val, 2),
        "trend":            trend,
        "crossed_above":    prev_trend == "SHORT" and trend == "LONG",
        "crossed_below":    prev_trend == "LONG"  and trend == "SHORT",
        "last_close":       round(last_close, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /technical/supertrend/{symbol}   (must be defined BEFORE /{symbol})
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/supertrend/{symbol}")
async def get_supertrend(
    symbol:     str,
    period:     int   = Query(10,  ge=5,  le=50),
    multiplier: float = Query(3.0, ge=1.0, le=6.0),
):
    symbol = symbol.upper().strip()
    try:
        df = fetch_ohlcv(symbol, period="3mo")
        if len(df) < period + 5:
            raise ValueError(f"Not enough bars for SuperTrend on '{symbol}'.")
        result = _compute_supertrend(df, period=period, multiplier=multiplier)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SuperTrend failed: {exc}")

    return {
        "symbol":            symbol,
        "period":            period,
        "multiplier":        multiplier,
        "supertrend_value":  result["supertrend_value"],
        "trend":             result["trend"],
        "crossed_above":     result["crossed_above"],
        "crossed_below":     result["crossed_below"],
        "last_close":        result["last_close"],
        "timestamp":         datetime.now(timezone.utc).isoformat(),
    }


def _get_cache() -> _redis.Redis | None:
    global _cache
    if _cache is None:
        try:
            _cache = _redis.from_url(settings.redis_url, decode_responses=True)
            _cache.ping()
        except Exception:
            _cache = None
    return _cache


# ─────────────────────────────────────────────────────────────────────────────
# GET /technical/{symbol}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{symbol}", response_model=TechnicalSignalResponse)
async def get_technical_signal(symbol: str):
    """
    Compute and return the full technical signal for one NSE symbol.

    Output includes: RSI, MACD, MACD signal, BB upper/lower/position,
    VWAP, EMA9, EMA21, volume, volume_ratio, volume_anomaly flag,
    and a composite technical_score (0-100).
    """
    symbol = symbol.upper().strip()
    cache_key = f"finolens:technical:{symbol}"

    rc = _get_cache()
    if rc:
        try:
            raw = rc.get(cache_key)
            if raw:
                return TechnicalSignalResponse.model_validate_json(raw)
        except Exception:
            pass

    try:
        result = compute_technical_signals(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Technical computation failed: {exc}")

    if rc:
        try:
            rc.setex(cache_key, settings.cache_ttl_seconds, result.model_dump_json())
        except Exception:
            pass

    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /technical/batch?symbols=RELIANCE,TCS,INFY
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/batch/all", response_model=list[TechnicalSignalResponse])
async def get_technical_batch(
    symbols: str = Query(
        default=None,
        description="Comma-separated NSE symbols. Omit to run on all Nifty 50.",
    )
):
    """
    Compute technical signals for multiple symbols concurrently.
    Defaults to the full Nifty 50 list if no symbols are provided.
    """
    target = NIFTY50_SYMBOLS if not symbols else [s.strip().upper() for s in symbols.split(",")]

    loop = asyncio.get_event_loop()

    async def _one(sym: str) -> TechnicalSignalResponse | None:
        rc = _get_cache()
        cache_key = f"finolens:technical:{sym}"
        if rc:
            try:
                raw = rc.get(cache_key)
                if raw:
                    return TechnicalSignalResponse.model_validate_json(raw)
            except Exception:
                pass
        try:
            result = await loop.run_in_executor(None, compute_technical_signals, sym)
            if rc:
                try:
                    rc.setex(cache_key, settings.cache_ttl_seconds, result.model_dump_json())
                except Exception:
                    pass
            return result
        except Exception:
            return None  # skip symbols that fail (delisted, no data, etc.)

    results = await asyncio.gather(*[_one(s) for s in target])
    return [r for r in results if r is not None]
