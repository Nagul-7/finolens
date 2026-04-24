from fastapi import APIRouter, HTTPException, Query
from app.models.schemas import CallResponse
from app.services.signal_generator import generate_call
from app.services.nse_client import NIFTY50_SYMBOLS, NIFTY50_NAMES
import json, redis as _redis
from app.core.config import settings

router = APIRouter(prefix="/signals", tags=["signals"])

_cache: _redis.Redis | None = None


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
# GET /signals/{symbol}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{symbol}", response_model=CallResponse)
async def get_signal(symbol: str):
    """
    Return a BUY / SELL / NEUTRAL call for the given NSE symbol.
    Results are cached in Redis for `settings.cache_ttl_seconds`.
    """
    symbol = symbol.upper().strip()
    cache_key = f"finolens:signal:{symbol}"

    # ── cache hit ─────────────────────────────────────────────────────────
    rc = _get_cache()
    if rc:
        try:
            raw = rc.get(cache_key)
            if raw:
                return CallResponse.model_validate_json(raw)
        except Exception:
            pass

    # ── compute ───────────────────────────────────────────────────────────
    try:
        result = generate_call(symbol)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Signal computation failed: {exc}")

    # ── store in cache ────────────────────────────────────────────────────
    if rc:
        try:
            rc.setex(cache_key, settings.cache_ttl_seconds, result.model_dump_json())
        except Exception:
            pass

    return result


# ─────────────────────────────────────────────────────────────────────────────
# GET /signals/  — list all Nifty50 symbols (metadata only, no computation)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[dict])
async def list_symbols():
    """Return all Nifty 50 symbols with their display names."""
    return [
        {"symbol": s, "name": NIFTY50_NAMES.get(s, s), "exchange": "NSE"}
        for s in NIFTY50_SYMBOLS
    ]
