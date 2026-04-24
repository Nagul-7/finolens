from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime


class IndicatorSignal(BaseModel):
    indicator: str
    signal: Literal["BUY", "SELL", "NEUTRAL"]
    raw_value: float
    weight: float = 1.0
    reason: str


class IndicatorSnapshot(BaseModel):
    rsi: float
    macd: float
    macd_signal: float
    macd_histogram: float
    bb_upper: float
    bb_middle: float
    bb_lower: float
    bb_position: float
    ema_20: float
    ema_50: float


class CallResponse(BaseModel):
    symbol: str
    name: str | None = None
    exchange: str = "NSE"
    call: Literal["BUY", "SELL", "NEUTRAL"]
    confidence: float = Field(..., ge=0, le=100)
    current_price: float
    entry: float
    stop_loss: float
    target: float
    risk_reward: str
    validity: str = "3-5 trading days"
    signals: list[IndicatorSignal]
    indicators: IndicatorSnapshot
    generated_at: datetime


# ── Market data ───────────────────────────────────────────────────────────────

class QuoteResponse(BaseModel):
    symbol: str
    name: str | None = None
    price: float
    volume: int


class LiveQuoteResponse(BaseModel):
    symbol: str
    name: str | None = None
    ltp: float
    open: float
    high: float
    low: float
    close: float          # previous session close
    volume: int
    change: float
    change_pct: float
    timestamp: str


class OHLCVBar(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class IndexQuote(BaseModel):
    symbol: str
    name: str
    ltp: float
    change: float
    change_pct: float


class MarketIndexResponse(BaseModel):
    nifty: IndexQuote
    banknifty: IndexQuote
    timestamp: str


# ── Technical signals ─────────────────────────────────────────────────────────

class TechnicalSignalResponse(BaseModel):
    symbol: str
    timestamp: datetime

    # Price
    current_price: float = 0.0
    change_pct: float = 0.0

    # Indicator values
    rsi: float
    macd: float
    macd_signal: float
    macd_hist: float = 0.0
    bb_upper: float
    bb_lower: float
    bb_mid: float = 0.0
    bb_position: float
    vwap: float
    ema9: float
    ema21: float

    # Volume
    volume: int
    volume_ratio: float
    volume_anomaly: bool

    # Key levels
    support: float = 0.0
    resistance: float = 0.0

    # Aggregate
    technical_score: float = Field(..., ge=0, le=100)


# ── Options chain ─────────────────────────────────────────────────────────────

class OptionsRow(BaseModel):
    strike: float
    oi: int
    chg_oi: int = 0
    volume: int
    iv: float
    ltp: float
    ltp_chg_pct: float
    itm: bool = False


class OptionsChainResponse(BaseModel):
    symbol: str
    expiry: str
    current_price: float
    pcr: float
    max_pain: float
    ai_signal: str
    ai_reason: str
    calls: list[OptionsRow]
    puts: list[OptionsRow]


# ── Screener ──────────────────────────────────────────────────────────────────

class ScreenerRow(BaseModel):
    symbol: str
    sector: str
    ltp: float
    change_pct: float
    score: float
    signal: str
    trigger_reason: str


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    timestamp: Optional[str] = None
