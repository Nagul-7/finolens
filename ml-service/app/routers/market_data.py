"""
Market data endpoints — live quotes, OHLCV history, and index snapshots.
"""

from fastapi import APIRouter, HTTPException, Query
from app.services.nse_client import fetch_live_quote, fetch_index_quote
from app.models.schemas import LiveQuoteResponse, OHLCVBar, MarketIndexResponse, IndexQuote
from datetime import datetime, timezone

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


@router.get("/ohlcv/{symbol}", response_model=list[OHLCVBar])
async def get_ohlcv(
    symbol: str,
    interval: str = Query("1d", description="1d | 1h | 5m | 15m"),
    from_date: str | None = Query(None, alias="from"),
    to_date:   str | None = Query(None, alias="to"),
):
    symbol = symbol.upper().strip()
    if symbol.endswith(".NS"):
        symbol = symbol[:-3]

    _interval_map = {
        "1d":  ("2y",  "1d"),
        "1h":  ("60d", "1h"),
        "5m":  ("5d",  "5m"),
        "15m": ("7d",  "15m"),
        "30m": ("14d", "30m"),
    }
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

        return [
            OHLCVBar(
                timestamp=str(ts),
                open=round(float(row["Open"]), 2),
                high=round(float(row["High"]), 2),
                low=round(float(row["Low"]), 2),
                close=round(float(row["Close"]), 2),
                volume=int(row["Volume"]),
            )
            for ts, row in df.iterrows()
        ]
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OHLCV fetch failed: {exc}")


@router.get("/index", response_model=MarketIndexResponse)
async def get_index():
    """Return live quotes for Nifty 50 and Bank Nifty."""
    try:
        nifty_data    = fetch_index_quote("^NSEI",    "NIFTY 50")
        banknifty_data = fetch_index_quote("^NSEBANK", "BANK NIFTY")
        return MarketIndexResponse(
            nifty=IndexQuote(**nifty_data),
            banknifty=IndexQuote(**banknifty_data),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Index fetch failed: {exc}")
