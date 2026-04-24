-- FinoLens Database Schema
-- PostgreSQL 16

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- stocks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocks (
    id          SERIAL PRIMARY KEY,
    symbol      VARCHAR(20)  NOT NULL UNIQUE,
    name        VARCHAR(150) NOT NULL,
    sector      VARCHAR(80),
    industry    VARCHAR(100),
    market_cap  NUMERIC(18, 2),
    exchange    VARCHAR(10)  NOT NULL DEFAULT 'NSE',
    is_nifty50  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stocks_symbol     ON stocks(symbol);
CREATE INDEX idx_stocks_is_nifty50 ON stocks(is_nifty50) WHERE is_nifty50 = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- calls  (generated trade recommendations)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calls (
    id            SERIAL PRIMARY KEY,
    uuid          UUID         NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
    symbol        VARCHAR(20)  NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    call_type     VARCHAR(10)  NOT NULL CHECK (call_type IN ('BUY', 'SELL', 'NEUTRAL')),
    confidence    NUMERIC(5, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    current_price NUMERIC(12, 2) NOT NULL,
    entry_price   NUMERIC(12, 2) NOT NULL,
    stop_loss     NUMERIC(12, 2) NOT NULL,
    target_price  NUMERIC(12, 2) NOT NULL,
    risk_reward   VARCHAR(10),
    validity_days SMALLINT     NOT NULL DEFAULT 5,
    status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'HIT_TARGET', 'HIT_STOP', 'EXPIRED', 'CANCELLED')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '5 days',
    closed_at     TIMESTAMPTZ,
    pnl_pct       NUMERIC(8, 4)  -- filled when status changes
);

CREATE INDEX idx_calls_symbol     ON calls(symbol);
CREATE INDEX idx_calls_status     ON calls(status);
CREATE INDEX idx_calls_created_at ON calls(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- signals  (per-indicator breakdown for each call)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signals (
    id          SERIAL PRIMARY KEY,
    call_id     INTEGER      NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    indicator   VARCHAR(30)  NOT NULL,          -- RSI | MACD | BB | EMA_CROSS | VWAP
    signal_type VARCHAR(10)  NOT NULL CHECK (signal_type IN ('BUY', 'SELL', 'NEUTRAL')),
    raw_value   NUMERIC(14, 6),
    weight      NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
    reason      TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signals_call_id   ON signals(call_id);
CREATE INDEX idx_signals_indicator ON signals(indicator);

-- ─────────────────────────────────────────────────────────────────────────────
-- indicator_snapshots  (raw OHLCV-derived values stored per run)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicator_snapshots (
    id            SERIAL PRIMARY KEY,
    symbol        VARCHAR(20)  NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    snapshot_date DATE         NOT NULL DEFAULT CURRENT_DATE,
    close_price   NUMERIC(12, 2) NOT NULL,
    rsi_14        NUMERIC(8, 4),
    macd          NUMERIC(12, 6),
    macd_signal   NUMERIC(12, 6),
    macd_hist     NUMERIC(12, 6),
    bb_upper      NUMERIC(12, 2),
    bb_middle     NUMERIC(12, 2),
    bb_lower      NUMERIC(12, 2),
    bb_position   NUMERIC(6, 2),   -- 0-100%, where price sits in BB range
    ema_20        NUMERIC(12, 2),
    ema_50        NUMERIC(12, 2),
    volume        BIGINT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, snapshot_date)
);

CREATE INDEX idx_snapshots_symbol ON indicator_snapshots(symbol, snapshot_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- backtest_results
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backtest_results (
    id              SERIAL PRIMARY KEY,
    symbol          VARCHAR(20)  NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    strategy        VARCHAR(80)  NOT NULL,
    period_start    DATE         NOT NULL,
    period_end      DATE         NOT NULL,
    total_trades    INTEGER      NOT NULL DEFAULT 0,
    winning_trades  INTEGER      NOT NULL DEFAULT 0,
    losing_trades   INTEGER      NOT NULL DEFAULT 0,
    win_rate        NUMERIC(6, 2),              -- percent
    total_return    NUMERIC(10, 4),             -- percent
    max_drawdown    NUMERIC(10, 4),             -- percent
    sharpe_ratio    NUMERIC(10, 6),
    avg_holding_days NUMERIC(6, 1),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_backtest_symbol   ON backtest_results(symbol);
CREATE INDEX idx_backtest_strategy ON backtest_results(strategy);

-- ─────────────────────────────────────────────────────────────────────────────
-- ohlcv_daily  (one row per symbol per trading day)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_daily (
    id         BIGSERIAL PRIMARY KEY,
    symbol     VARCHAR(20)    NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    date       DATE           NOT NULL,
    open       NUMERIC(12, 2) NOT NULL,
    high       NUMERIC(12, 2) NOT NULL,
    low        NUMERIC(12, 2) NOT NULL,
    close      NUMERIC(12, 2) NOT NULL,
    volume     BIGINT         NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, date)
);

CREATE INDEX idx_ohlcv_daily_symbol_date ON ohlcv_daily(symbol, date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- ohlcv_intraday  (1m / 5m / 15m / 1h bars)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ohlcv_intraday (
    id         BIGSERIAL PRIMARY KEY,
    symbol     VARCHAR(20)    NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    ts         TIMESTAMPTZ    NOT NULL,
    open       NUMERIC(12, 2) NOT NULL,
    high       NUMERIC(12, 2) NOT NULL,
    low        NUMERIC(12, 2) NOT NULL,
    close      NUMERIC(12, 2) NOT NULL,
    volume     BIGINT         NOT NULL DEFAULT 0,
    interval   VARCHAR(5)     NOT NULL CHECK (interval IN ('1m','5m','15m','30m','1h')),
    created_at TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, ts, interval)
);

CREATE INDEX idx_ohlcv_intraday_symbol_ts ON ohlcv_intraday(symbol, ts DESC, interval);

-- ─────────────────────────────────────────────────────────────────────────────
-- watchlist
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
    id       SERIAL      PRIMARY KEY,
    symbol   VARCHAR(20) NOT NULL REFERENCES stocks(symbol) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (symbol)
);

CREATE INDEX idx_watchlist_symbol ON watchlist(symbol);

-- ─────────────────────────────────────────────────────────────────────────────
-- auto-update updated_at on stocks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stocks_updated_at
    BEFORE UPDATE ON stocks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
