const express = require("express");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 30000 });

// GET /api/market/quote/:symbol
router.get("/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const cacheKey = `finolens:quote:${symbol}`;

  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const { data } = await ML.get(`/market/quote/${symbol}`);
    await cacheService.set(cacheKey, data, 60); // 1-min TTL for quotes
    return res.json({ ...data, cached: false });
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: `Symbol '${symbol}' not found.` });
    return res.status(502).json({ error: "Quote fetch failed.", detail: err.message });
  }
});

// GET /api/market/ohlcv/:symbol?interval=1d
router.get("/ohlcv/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const interval = req.query.interval || "1d";
  const from = req.query.from || null;
  const to = req.query.to || null;

  const cacheKey = `finolens:ohlcv:${symbol}:${interval}:${from}:${to}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const params = { interval };
    if (from) params.from = from;
    if (to) params.to = to;
    const { data } = await ML.get(`/market/ohlcv/${symbol}`, { params });
    await cacheService.set(cacheKey, data, 300);
    return res.json(data);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return res.status(404).json({ error: `No OHLCV data for '${symbol}'.` });
    return res.status(502).json({ error: "OHLCV fetch failed.", detail: err.message });
  }
});

// GET /api/market/index
router.get("/index", async (req, res) => {
  const cacheKey = "finolens:market:index";
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const { data } = await ML.get("/market/index");
    await cacheService.set(cacheKey, data, 60);
    return res.json({ ...data, cached: false });
  } catch (err) {
    return res.status(502).json({ error: "Index fetch failed.", detail: err.message });
  }
});

module.exports = router;
