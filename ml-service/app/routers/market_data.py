"""
Market data endpoints — live quotes, OHLCV history, and index snapshots.
"""

from fastapi import APIRouter, HTTPException, Query
from app.services.nse_client import fetch_live_quote, fetch_index_quote
from app.models.schemas import LiveQuoteResponse, OHLCVBar, MarketIndexResponse, IndexQuote
from datetime import datetime, timezone
import math

router = APIRouter(prefix="/market", tags=["market-data"])


@router.get("/quote/{symbol}", response_model=LiveQuoteResponse)
async def get_quote(symbol: str):
    symbol = symbol.upper().strip()
    # Strip .NS suffix if caller included it
    if symbol.endswith(".NS"):
        symbol = symbol[:-3]
    try:
        data = fetch_live_quote(symbol)
        return LiveQuoteResponse(**{k: data[k] for k in LiveQuoteResponse.model_fields if k in data})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Quote fetch failed: {exc}")


def _safe_float(v):
    """Return None for NaN/Inf so JSON serialization never crashes."""
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 2)
    except (TypeError, ValueError):
        return None


def _safe_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


@router.get("/ohlcv/{symbol}", response_model=list[OHLCVBar])
async def get_ohlcv(
    symbol: str,
    interval: str = Query("1d", description="1d | 5d | 1h | 5m | 15m | 1wk | 1mo | 3mo | 1y"),
    from_date: str | None = Query(None, alias="from"),
    to_date:   str | None = Query(None, alias="to"),
):
    symbol = symbol.upper().strip()
    if symbol.endswith(".NS"):
        symbol = symbol[:-3]

    # Map frontend interval strings -> (yfinance period default, yfinance interval string)
    # The period is only used when no from/to date range is specified.
    # Frontend timeframe buttons send: 1d=>'1d', 5d=>'5d', 1m=>'1mo', 3m=>'3mo', 1y=>'1y'
    # yfinance only accepts: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
    _interval_map = {
        "1d":  ("5d",   "1d"),
        "5d":  ("1mo",  "1d"),
        "1h":  ("3mo",  "1h"),
        "5m":  ("5d",   "5m"),
        "15m": ("5d",   "15m"),
        "30m": ("1mo",  "30m"),
        "1wk": ("6mo",  "1wk"),
        "1mo": ("1y",   "1d"),
        "3mo": ("2y",   "1d"),
        "1y":  ("5y",   "1d"),
    }
    _intraday = {"5m", "15m", "30m", "1h"}
    if interval not in _interval_map:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported interval '{interval}'. Use: {list(_interval_map)}"
        )

    period_default, yf_interval = _interval_map[interval]

    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol}.NS")

        if from_date and to_date:
            df = ticker.history(start=from_date, end=to_date,
                                interval=yf_interval, auto_adjust=True)
        else:
            df = ticker.history(period=period_default,
                                interval=yf_interval, auto_adjust=True)

        if df.empty:
            raise ValueError(f"No OHLCV data for '{symbol}'.")

        is_intraday = yf_interval in _intraday
        bars = []
        for ts, row in df.iterrows():
            o  = _safe_float(row["Open"])
            h  = _safe_float(row["High"])
            lo = _safe_float(row["Low"])
            c  = _safe_float(row["Close"])
            v  = _safe_int(row["Volume"])
            if None in (o, h, lo, c):
                continue
            timestamp = int(ts.timestamp()) if is_intraday else ts.strftime('%Y-%m-%d')
            bars.append(OHLCVBar(
                timestamp=timestamp,
                open=o,
                high=h,
                low=lo,
                close=c,
                volume=v,
            ))
        return bars
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OHLCV fetch failed: {exc}")


@router.get("/index", response_model=MarketIndexResponse)
async def get_index():
    """Return live quotes for Nifty 50 and Bank Nifty."""
    try:
        nifty_data     = fetch_index_quote("^NSEI",    "NIFTY 50")
        banknifty_data = fetch_index_quote("^NSEBANK", "BANK NIFTY")
        return MarketIndexResponse(
            nifty=IndexQuote(**nifty_data),
            banknifty=IndexQuote(**banknifty_data),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Index fetch failed: {exc}")
