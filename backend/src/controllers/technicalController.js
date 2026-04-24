const technicalService = require("../services/technicalService");
const cacheService = require("../services/cacheService");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/technical/:symbol
// ─────────────────────────────────────────────────────────────────────────────
async function getTechnical(req, res) {
  const symbol = req.params.symbol.toUpperCase().trim();
  const cacheKey = `finolens:technical:${symbol}`;

  const cached = await cacheService.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  let result;
  try {
    result = await technicalService.getTechnicalSignal(symbol);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(404).json({ error: `Symbol '${symbol}' not found on NSE.` });
    }
    console.error(`[technical] ML error for ${symbol}:`, err.message);
    return res.status(502).json({ error: "Technical signal computation unavailable." });
  }

  const ttl = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10);
  await cacheService.set(cacheKey, result, ttl);

  return res.json({ ...result, cached: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/technical/batch?symbols=RELIANCE,TCS,INFY
// ─────────────────────────────────────────────────────────────────────────────
async function getTechnicalBatch(req, res) {
  const raw = req.query.symbols;
  const symbols = raw ? raw.split(",").map((s) => s.trim().toUpperCase()) : null;

  try {
    const results = await technicalService.getBatchTechnicalSignals(symbols);
    return res.json(results);
  } catch (err) {
    console.error("[technical] batch error:", err.message);
    return res.status(502).json({ error: "Batch technical signal computation failed." });
  }
}

module.exports = { getTechnical, getTechnicalBatch };
