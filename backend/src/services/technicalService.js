const axios = require("axios");

const ML_BASE = process.env.ML_SERVICE_URL || "http://localhost:8000";

const http = axios.create({
  baseURL: ML_BASE,
  timeout: 45_000,  // batch calls for full Nifty50 can take longer
});

/**
 * Fetch technical signals for a single NSE symbol.
 * Returns: { symbol, timestamp, rsi, macd, macd_signal, bb_upper, bb_lower,
 *            bb_position, vwap, ema9, ema21, volume, volume_ratio,
 *            volume_anomaly, technical_score }
 * @param {string} symbol
 */
async function getTechnicalSignal(symbol) {
  const { data } = await http.get(`/technical/${symbol.toUpperCase()}`);
  return data;
}

/**
 * Batch-fetch technical signals.
 * @param {string[]|null} symbols  Array of NSE symbols, or null for all Nifty50.
 */
async function getBatchTechnicalSignals(symbols = null) {
  const params = symbols?.length ? { symbols: symbols.join(",") } : {};
  const { data } = await http.get("/technical/batch/all", { params });
  return data;
}

module.exports = { getTechnicalSignal, getBatchTechnicalSignals };
