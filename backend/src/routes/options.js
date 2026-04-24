const express = require("express");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 45000 });

// GET /api/options/chain/:symbol
router.get("/chain/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  const cacheKey = `finolens:options:${symbol}`;

  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  try {
    const { data } = await ML.get(`/options/chain/${symbol}`);
    await cacheService.set(cacheKey, data, 300);
    return res.json({ ...data, cached: false });
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(404).json({ error: `No options data for '${symbol}'.` });
    }
    return res.status(502).json({ error: "Options chain fetch failed.", detail: err.message });
  }
});

module.exports = router;
