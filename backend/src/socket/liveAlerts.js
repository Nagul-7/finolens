/**
 * Live alerts — emits real-time events via Socket.IO during market hours.
 *
 * Events:
 *   price_update   — live quotes for all watchlist symbols (every 30 s)
 *   new_call       — new STRONG BUY / STRONG SELL signal detected (every 60 s scan)
 *   volume_spike   — volume anomaly detected on a watchlist symbol
 */

const axios = require("axios");

const ML = axios.create({
  baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000",
  timeout: 25000,
});

const DEFAULT_WATCHLIST = ["RELIANCE", "HDFCBANK", "TCS", "INFY"];

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return totalMins >= 555 && totalMins <= 930; // 9:15 – 3:30 IST
}

async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(
    symbols.map((s) => ML.get(`/market/quote/${s}`))
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value.data);
}

async function scanForAlerts(symbols, io) {
  const results = await Promise.allSettled(
    symbols.map((s) => ML.get(`/signals/${s}`))
  );

  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const d = r.value.data;
    const sym = symbols[i];

    if (d.call === "BUY" && d.confidence >= 70) {
      io.emit("new_call", {
        symbol: sym,
        call: d.call,
        confidence: d.confidence,
        price: d.current_price,
        reason: d.signals?.[0]?.reason || "Technical signal",
        timestamp: new Date().toISOString(),
      });
    }

    if (d.indicators?.volume_ratio > 2.0) {
      io.emit("volume_spike", {
        symbol: sym,
        volume_ratio: d.indicators.volume_ratio,
        price: d.current_price,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

function setupLiveAlerts(io, getWatchlistFn) {
  let priceInterval = null;
  let signalInterval = null;

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
      const quotes = await fetchQuotes(symbols);
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

  // Cleanup helper (for graceful shutdown)
  return () => {
    clearInterval(priceInterval);
    clearInterval(signalInterval);
  };
}

module.exports = { setupLiveAlerts };
