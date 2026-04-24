from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ml_port: int = 8000
    redis_url: str = "redis://localhost:6379"
    cache_ttl_seconds: int = 300      # 5 minutes — yfinance has ~15 min delay anyway
    ohlcv_period: str = "6mo"         # history window for indicator calculation
    rsi_period: int = 14
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    bb_period: int = 20
    bb_std_dev: float = 2.0
    risk_pct: float = 0.025           # 2.5% stop-loss distance

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
