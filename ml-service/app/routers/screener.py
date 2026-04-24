"""
Screener endpoint.

GET /screener/scan
  Computes technical signals for the most-liquid Nifty 50 symbols concurrently
  and returns filtered, ranked results.

Query params:
  signal   : BUY | SELL | STRONG BUY | STRONG SELL | NEUTRAL
  min_score: float  (0-100)
  sector   : string (e.g. "Banking", "Information Tech")
  volume   : string (e.g. "2x" → volume_ratio > 2)
  rsi_min  : float
  rsi_max  : float
"""

import asyncio
from fastapi import APIRouter, Query
from app.models.schemas import ScreenerRow
from app.services.technical_calculator import compute_technical_signals
from app.services.nse_client import NIFTY50_SYMBOLS, SECTOR_MAP

router = APIRouter(prefix="/screener", tags=["screener"])

# Top-25 most liquid Nifty50 symbols for the screener (avoids timeout on full 50)
SCREENER_UNIVERSE = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY",
    "HINDUNILVR", "ITC", "KOTAKBANK", "SBIN", "AXISBANK",
    "BAJFINANCE", "BHARTIARTL", "LT", "HCLTECH", "WIPRO",
    "TATAMOTORS", "MARUTI", "SUNPHARMA", "TITAN", "NTPC",
    "POWERGRID", "ONGC", "TECHM", "NESTLEIND", "DRREDDY",
]


def _derive_signal(score: float) -> str:
    if score >= 75:  return "STRONG BUY"
    if score >= 58:  return "BUY"
    if score <= 25:  return "STRONG SELL"
    if score <= 42:  return "SELL"
    return "NEUTRAL"


def _trigger_reason(sig: "TechnicalSignalResponse") -> str:  # type: ignore[name-defined]
    reasons = []
    if sig.rsi <= 30:
        reasons.append(f"RSI Oversold ({sig.rsi:.1f})")
    elif sig.rsi >= 70:
        reasons.append(f"RSI Overbought ({sig.rsi:.1f})")
    if sig.macd_hist > 0 and sig.macd_hist > abs(sig.macd * 0.05):
        reasons.append("MACD Bullish Crossover" if sig.macd_hist > 0 else "")
    elif sig.macd_hist < 0:
        reasons.append("MACD Bearish")
    if sig.volume_anomaly:
        reasons.append(f"Vol Spike ({sig.volume_ratio:.1f}x)")
    if sig.current_price > sig.vwap:
        reasons.append("Above VWAP")
    elif sig.current_price < sig.vwap:
        reasons.append("Below VWAP")
    if sig.ema9 > sig.ema21:
        reasons.append("EMA Bullish")
    reasons = [r for r in reasons if r]
    return " + ".join(reasons[:3]) if reasons else "Technical Signal"


def _vol_filter_passes(vol_ratio: float, vol_param: str | None) -> bool:
    if not vol_param or vol_param == "Any":
        return True
    if vol_param == ">1x Avg":
        return vol_ratio > 1.0
    if vol_param == ">2x Avg":
        return vol_ratio > 2.0
    if vol_param in ("Spike Vol", "spike"):
        return vol_ratio > 2.5
    return True


def _signal_filter_passes(signal: str, filter_val: str | None) -> bool:
    if not filter_val:
        return True
    fv = filter_val.upper()
    if fv == "BUY":
        return "BUY" in signal
    if fv == "SELL":
        return "SELL" in signal
    return signal.upper() == fv


@router.get("/scan", response_model=list[ScreenerRow])
async def scan_screener(
    signal:    str   | None = Query(None),
    min_score: float        = Query(0.0),
    sector:    str   | None = Query(None),
    volume:    str   | None = Query(None),
    rsi_min:   float        = Query(0.0),
    rsi_max:   float        = Query(100.0),
):
    loop = asyncio.get_event_loop()

    async def _compute_one(sym: str):
        try:
            return await loop.run_in_executor(None, compute_technical_signals, sym)
        except Exception:
            return None

    # Run all concurrently with a semaphore to limit parallelism
    sem = asyncio.Semaphore(8)

    async def _bounded(sym):
        async with sem:
            return await _compute_one(sym)

    results = await asyncio.gather(*[_bounded(s) for s in SCREENER_UNIVERSE])

    rows: list[ScreenerRow] = []
    for sym, res in zip(SCREENER_UNIVERSE, results):
        if res is None:
            continue

        sym_signal = _derive_signal(res.technical_score)
        sym_sector = SECTOR_MAP.get(sym, "Other")

        if not _signal_filter_passes(sym_signal, signal):
            continue
        if res.technical_score < min_score:
            continue
        if sector and sector.lower() not in sym_sector.lower():
            continue
        if not _vol_filter_passes(res.volume_ratio, volume):
            continue
        if res.rsi < rsi_min or res.rsi > rsi_max:
            continue

        rows.append(ScreenerRow(
            symbol=sym,
            sector=sym_sector,
            ltp=res.current_price,
            change_pct=res.change_pct,
            score=res.technical_score,
            signal=sym_signal,
            trigger_reason=_trigger_reason(res),
        ))

    rows.sort(key=lambda r: r.score, reverse=True)
    return rows
