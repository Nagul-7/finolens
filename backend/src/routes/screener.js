const express = require("express");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 120000 });

// POST /api/screener  — body: { signal, min_score, sector, volume, rsi_min, rsi_max }
// GET  /api/screener  — query params version
router.all("/", async (req, res) => {
  const params = req.method === "POST" ? req.body : req.query;
  const { signal, min_score, sector, volume, rsi_min, rsi_max } = params;

  const cacheKey = `finolens:screener:${JSON.stringify(params)}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const queryParams = {};
    if (signal)    queryParams.signal    = signal;
    if (min_score) queryParams.min_score = min_score;
    if (sector)    queryParams.sector    = sector;
    if (volume)    queryParams.volume    = volume;
    if (rsi_min)   queryParams.rsi_min   = rsi_min;
    if (rsi_max)   queryParams.rsi_max   = rsi_max;

    const { data } = await ML.get("/screener/scan", { params: queryParams });
    await cacheService.set(cacheKey, data, 180);
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: "Screener scan failed.", detail: err.message });
  }
});

module.exports = router;
