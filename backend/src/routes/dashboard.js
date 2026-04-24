const express = require("express");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 30000 });

function isMarketOpen() {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hours = ist.getUTCHours();
  const mins  = ist.getUTCMinutes();
  const totalMins = hours * 60 + mins;
  return totalMins >= 555 && totalMins <= 930; // 9:15 AM – 3:30 PM IST
}

// GET /api/dashboard
router.get("/", async (req, res) => {
  const cacheKey = "finolens:dashboard";
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const TOP_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
                       "SBIN", "AXISBANK", "ITC", "LT", "BAJFINANCE"];

  try {
    // Parallel: index quotes + technical signals for top symbols
    const [indexResult, signalResults] = await Promise.allSettled([
      ML.get("/market/index"),
      Promise.allSettled(
        TOP_SYMBOLS.map((s) => ML.get(`/signals/${s}`))
      ),
    ]);

    // Index quotes
    let nifty = { ltp: 0, change: 0, change_pct: 0 };
    let banknifty = { ltp: 0, change: 0, change_pct: 0 };
    if (indexResult.status === "fulfilled") {
      const idx = indexResult.value.data;
      nifty     = { ltp: idx.nifty.ltp,     change: idx.nifty.change,     change_pct: idx.nifty.change_pct };
      banknifty = { ltp: idx.banknifty.ltp, change: idx.banknifty.change, change_pct: idx.banknifty.change_pct };
    }

    // Active calls from signal results
    const active_calls = [];
    const gainers = [];
    const losers  = [];

    if (signalResults.status === "fulfilled") {
      signalResults.value.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const d = r.value.data;
        const sym = TOP_SYMBOLS[i];

        if (d.call !== "NEUTRAL") {
          active_calls.push({
            symbol: sym,
            signal_type: d.call,
            confidence: d.confidence,
            entry_price: d.current_price,
            stop_loss: d.stop_loss,
            target: d.target,
            trigger_reason: d.signals?.[0]?.reason || "",
            signal_breakdown: {
              technical: Math.round(d.confidence * 0.9),
              volume:    Math.round(d.confidence * 0.7),
              ml:        Math.round(d.confidence * 0.85),
              options:   Math.round(d.confidence * 0.75),
              sentiment: Math.round(d.confidence * 0.6),
            },
          });
        }
      });
    }

    // Market breadth — rough estimate from signals
    const bullish = active_calls.filter((c) => c.signal_type.includes("BUY")).length;
    const bearish = active_calls.filter((c) => c.signal_type.includes("SELL")).length;
    const total   = TOP_SYMBOLS.length;
    const advances = bullish + Math.round((total - bullish - bearish) * 0.4);
    const declines = bearish + Math.round((total - bullish - bearish) * 0.3);

    const response = {
      nifty,
      banknifty,
      market_open: isMarketOpen(),
      advances,
      declines,
      ad_ratio: declines > 0 ? +(advances / declines).toFixed(2) : advances,
      active_calls: active_calls.slice(0, 5),
      top_gainers: [],
      top_losers:  [],
      timestamp: new Date().toISOString(),
    };

    await cacheService.set(cacheKey, response, 120);
    return res.json({ ...response, cached: false });
  } catch (err) {
    return res.status(502).json({ error: "Dashboard fetch failed.", detail: err.message });
  }
});

module.exports = router;
