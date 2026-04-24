const mlService = require("../services/mlService");
const cacheService = require("../services/cacheService");
const callsService = require("../services/callsService");
const db = require("../config/database");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calls/:symbol
// ─────────────────────────────────────────────────────────────────────────────
async function getCall(req, res) {
  const symbol = req.params.symbol.toUpperCase().trim();
  const cacheKey = `finolens:call:${symbol}`;

  // 1. Cache hit
  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  // 2. Fetch from ML service
  let signal;
  try {
    signal = await mlService.getSignal(symbol);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(404).json({ error: `Symbol '${symbol}' not found on NSE.` });
    }
    console.error(`[calls] ML service error for ${symbol}:`, err.message);
    return res.status(502).json({ error: "Signal computation unavailable. Try again shortly." });
  }

  // 3. Persist to DB (non-blocking — failure doesn't break the response)
  callsService.saveCall(signal).catch((err) =>
    console.warn(`[calls] DB persist failed for ${symbol}:`, err.message)
  );

  // 4. Cache for TTL
  const ttl = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10);
  await cacheService.set(cacheKey, signal, ttl);

  return res.json({ ...signal, cached: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calls  (recent calls history from DB)
// ─────────────────────────────────────────────────────────────────────────────
async function listCalls(req, res) {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const symbol = req.query.symbol?.toUpperCase() || null;

  try {
    const rows = await callsService.getRecentCalls(symbol, limit);
    return res.json(rows);
  } catch (err) {
    console.error("[calls] listCalls error:", err.message);
    return res.status(500).json({ error: "Failed to retrieve calls history." });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/symbols  — list all Nifty50 symbols
// ─────────────────────────────────────────────────────────────────────────────
async function listSymbols(req, res) {
  try {
    const { rows } = await db.query(
      "SELECT symbol, name, sector, industry FROM stocks WHERE is_nifty50 = TRUE ORDER BY symbol"
    );
    return res.json(rows);
  } catch {
    // Fallback to ML service if DB not seeded yet
    try {
      const symbols = await mlService.listSymbols();
      return res.json(symbols);
    } catch (err) {
      return res.status(500).json({ error: "Failed to retrieve symbols." });
    }
  }
}

module.exports = { getCall, listCalls, listSymbols };
