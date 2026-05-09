/**
 * Live alerts — emits real-time events via Socket.IO during market hours.
 *
 * Events emitted:
 *   price_update      — live quotes for watchlist symbols (every 30 s)
 *   new_call          — BUY/SELL signal from screener (every 60 s)
 *   volume_spike      — volume anomaly on a watchlist symbol
 *   strategy_alert    — stock highly aligned with an active strategy (score >= 85)
 *   position_update   — open position hit target/SL/trailing SL
 *   scan_complete     — daily 9:20 AM scan finished
 *   market_context    — market health + strategy recommendations (every 30 min)
 */

const axios = require("axios");

const ML = axios.create({
  baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000",
  timeout: 25_000,
});

// ─── Alert history (max 200, newest first) ───────────────────────────────────
const alertHistory = [];
const MAX_HISTORY  = 200;

function addAlert(event, data) {
  alertHistory.unshift({ event, ...data, recordedAt: new Date().toISOString() });
  if (alertHistory.length > MAX_HISTORY) alertHistory.pop();
}

const DEFAULT_WATCHLIST = ["RELIANCE", "HDFCBANK", "TCS", "INFY"];

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930; // 9:15 – 15:30 IST
}

async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(
    symbols.map(s => ML.get(`/market/quote/${s}`))
  );
  return results
    .filter(r => r.status === "fulfilled")
    .map(r => r.value.data);
}

async function scanForAlerts(symbols, io) {
  const results = await Promise.allSettled(
    symbols.map(s => ML.get(`/signals/${s}`))
  );

  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const d   = r.value.data;
    const sym = symbols[i];

    if (d.call === "BUY" && d.confidence >= 70) {
      const payload = {
        symbol:    sym,
        call:      d.call,
        confidence: d.confidence,
        price:     d.current_price,
        reason:    d.signals?.[0]?.reason || "Technical signal",
        timestamp: new Date().toISOString(),
      };
      io.emit("new_call", payload);
      addAlert("new_call", payload);
    }

    if (d.indicators?.volume_ratio > 2.0) {
      const payload = {
        symbol:       sym,
        volume_ratio: d.indicators.volume_ratio,
        price:        d.current_price,
        timestamp:    new Date().toISOString(),
      };
      io.emit("volume_spike", payload);
      addAlert("volume_spike", payload);
    }
  });
}

/**
 * Determine current NIFTY50 trend from recent OHLCV.
 * Returns 'UP' | 'DOWN' | 'SIDEWAYS'.
 */
async function getNiftyTrend() {
  try {
    const { data } = await ML.get("/market/ohlcv/NIFTY", {
      params: { interval: "1d", period: "1mo" },
    });
    if (!data || data.length < 10) return "SIDEWAYS";

    const closes = data.map(b => parseFloat(b.close));
    const n = closes.length;
    const ema9  = computeSimpleEMA(closes, 9);
    const ema21 = computeSimpleEMA(closes, 21);

    const cur9  = ema9[n - 1];
    const cur21 = ema21[n - 1];
    const prev9  = ema9[n - 5]  ?? cur9;
    const prev21 = ema21[n - 5] ?? cur21;

    // Trend UP: EMA9 > EMA21 and EMA9 is rising
    if (cur9 > cur21 && cur9 > prev9) return "UP";
    // Trend DOWN: EMA9 < EMA21 and EMA9 is falling
    if (cur9 < cur21 && cur9 < prev9) return "DOWN";
    return "SIDEWAYS";
  } catch {
    return "SIDEWAYS";
  }
}

function computeSimpleEMA(prices, period) {
  const k = 2 / (period + 1);
  const result = [];
  let val = prices[0];
  result.push(val);
  for (let i = 1; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

/**
 * Determine which strategies are recommended vs avoided based on market conditions.
 */
function getStrategyRecommendations(trend) {
  if (trend === "UP") {
    return {
      suitable_strategies:  ["dual_timeframe", "multi_momentum", "supertrend_confluence", "weekly_breakout"],
      avoid_strategies:     ["mean_reversion"],
      market_note:          "Bull trend — momentum and breakout strategies are optimal. Mean reversion is risky in uptrends.",
    };
  }
  if (trend === "DOWN") {
    return {
      suitable_strategies:  ["mean_reversion"],
      avoid_strategies:     ["multi_momentum", "supertrend_confluence", "weekly_breakout", "dual_timeframe"],
      market_note:          "Bear trend — avoid momentum strategies. Mean reversion only if stock quality is confirmed.",
    };
  }
  // SIDEWAYS
  return {
    suitable_strategies:  ["mean_reversion", "weekly_breakout"],
    avoid_strategies:     ["supertrend_confluence"],
    market_note:          "Sideways market — mean reversion and tight-range breakouts work best. SuperTrend gives false signals in ranging markets.",
  };
}

// ─── Wire up Socket.IO listeners for events emitted by algoEngine ────────────
// algoEngine emits: strategy_alert, position_update, scan_complete, new_algo_trade
// We forward these into alertHistory so they appear in /api/alerts/history.

function wireAlgoEngineEvents(io) {
  // Intercept strategy_alert events to record in history
  const originalEmit = io.emit.bind(io);
  const tracked = new Set([
    "strategy_alert", "position_update", "scan_complete",
    "new_algo_trade", "algo_trade_closed", "daily_loss_limit_reached",
  ]);

  io.emit = function (event, ...args) {
    if (tracked.has(event) && args[0]) {
      addAlert(event, args[0]);
    }
    return originalEmit(event, ...args);
  };
}

// ─── Main setup ───────────────────────────────────────────────────────────────
function setupLiveAlerts(io, getWatchlistFn) {
  let priceInterval   = null;
  let signalInterval  = null;
  let contextInterval = null;

  // Wire engine events into history before anything starts
  wireAlgoEngineEvents(io);

  async function getSymbols() {
    try {
      return (await getWatchlistFn()) || DEFAULT_WATCHLIST;
    } catch {
      return DEFAULT_WATCHLIST;
    }
  }

  // Price updates every 30 seconds
  priceInterval = setInterval(async () => {
    if (!isMarketOpen()) return;
    try {
      const symbols = await getSymbols();
      const quotes  = await fetchQuotes(symbols);
      if (quotes.length) io.emit("price_update", { quotes, timestamp: new Date().toISOString() });
    } catch { /* non-fatal */ }
  }, 30_000);

  // Signal scan every 60 seconds
  signalInterval = setInterval(async () => {
    if (!isMarketOpen()) return;
    try {
      const symbols = await getSymbols();
      await scanForAlerts(symbols, io);
    } catch { /* non-fatal */ }
  }, 60_000);

  // Market context every 30 minutes during market hours
  contextInterval = setInterval(async () => {
    if (!isMarketOpen()) return;
    try {
      const trend = await getNiftyTrend();
      const recs  = getStrategyRecommendations(trend);
      const payload = {
        nifty_trend:          trend,
        suitable_strategies:  recs.suitable_strategies,
        avoid_strategies:     recs.avoid_strategies,
        market_note:          recs.market_note,
        timestamp:            new Date().toISOString(),
      };
      io.emit("market_context", payload);
      addAlert("market_context", payload);
    } catch { /* non-fatal */ }
  }, 30 * 60 * 1000);

  // Cleanup helper (for graceful shutdown)
  return () => {
    clearInterval(priceInterval);
    clearInterval(signalInterval);
    clearInterval(contextInterval);
  };
}

module.exports = { setupLiveAlerts, alertHistory };
