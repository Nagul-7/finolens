const axios = require("axios");

const ML_BASE = process.env.ML_SERVICE_URL || "http://localhost:8000";

const http = axios.create({
  baseURL: ML_BASE,
  timeout: 45000,
});

async function getSignal(symbol) {
  const { data } = await http.get(`/signals/${symbol.toUpperCase()}`);
  return data;
}

async function listSymbols() {
  const { data } = await http.get("/signals/");
  return data;
}

async function getQuote(symbol) {
  const { data } = await http.get(`/market/quote/${symbol.toUpperCase()}`);
  return data;
}

async function getOHLCV(symbol, interval = "1d", from = null, to = null) {
  const params = { interval };
  if (from) params.from = from;
  if (to)   params.to   = to;
  const { data } = await http.get(`/market/ohlcv/${symbol.toUpperCase()}`, { params });
  return data;
}

async function getIndexQuotes() {
  const { data } = await http.get("/market/index");
  return data;
}

async function getTechnicalSignals(symbol) {
  const { data } = await http.get(`/technical/${symbol.toUpperCase()}`);
  return data;
}

async function getBatchTechnicalSignals(symbols = null) {
  const params = symbols?.length ? { symbols: symbols.join(",") } : {};
  const { data } = await http.get("/technical/batch/all", { params });
  return data;
}

async function getOptionsChain(symbol) {
  const { data } = await http.get(`/options/chain/${symbol.toUpperCase()}`);
  return data;
}

async function scanScreener(filters = {}) {
  const { data } = await http.get("/screener/scan", { params: filters });
  return data;
}

async function getSuperTrend(symbol, period = 10, multiplier = 3) {
  const { data } = await http.get(
    `/technical/supertrend/${symbol.toUpperCase()}`,
    { params: { period, multiplier } }
  );
  return data;
}

module.exports = {
  getSignal,
  listSymbols,
  getQuote,
  getOHLCV,
  getIndexQuotes,
  getTechnicalSignals,
  getBatchTechnicalSignals,
  getOptionsChain,
  scanScreener,
  getSuperTrend,
};
