const express = require("express");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 30000 });

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hours = ist.getUTCHours();
  const mins  = ist.getUTCMinutes();
  const totalMins = hours * 60 + mins;
  return totalMins >= 555 && totalMins <= 930;
}

// GET /api/dashboard
router.get("/", async (req, res) => {
  const cacheKey = "finolens:dashboard";
  const cached = await cacheService.get(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const TOP_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
                       "SBIN", "AXISBANK", "ITC", "LT", "BAJFINANCE"];

  try {
    const [indexResult, signalResults] = await Promise.allSettled([
      ML.get("/market/index"),
      Promise.allSettled(
        TOP_SYMBOLS.map((s) => ML.get(`/technical/${s}`))
      ),
    ]);

    let nifty = { ltp: 0, change: 0, change_pct: 0 };
    let banknifty = { ltp: 0, change: 0, change_pct: 0 };
    if (indexResult.status === "fulfilled") {
      const idx = indexResult.value.data;
      nifty     = { ltp: idx.nifty.ltp,     change: idx.nifty.change,     change_pct: idx.nifty.change_pct };
      banknifty = { ltp: idx.banknifty.ltp, change: idx.banknifty.change, change_pct: idx.banknifty.change_pct };
    }

    const active_calls = [];
    if (signalResults.status === "fulfilled") {
      signalResults.value.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        const d   = r.value.data;
        const sym = TOP_SYMBOLS[i];
        // /technical returns: signal (BUY/SELL/NEUTRAL), technical_score, confidence, current_price, stop_loss, target
        const signal = d.signal || d.call || 'NEUTRAL';
        if (signal !== "NEUTRAL") {
          active_calls.push({
            symbol: sym,
            signal_type: signal,
            confidence: d.confidence || d.technical_score || 50,
            entry_price: d.current_price || 0,
            stop_loss: d.stop_loss || 0,
            target: d.target || 0,
            trigger_reason: d.signals?.[0]?.reason || "",
            signal_breakdown: {
              technical: Math.round((d.technical_score || 50) * 0.9),
              volume:    Math.round((d.volume_score   || 50) * 0.7),
              ml:        Math.round((d.technical_score || 50) * 0.85),
              options:   Math.round((d.technical_score || 50) * 0.75),
              sentiment: Math.round((d.technical_score || 50) * 0.6),
            },
          });
        }
      });
    }

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

// ─── Full market scan ─────────────────────────────────────────────────────────

const FULL_UNIVERSE = [
  // NIFTY 50
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK',
  'HINDUNILVR','SBIN','BHARTIARTL','ITC','KOTAKBANK',
  'LT','AXISBANK','ASIANPAINT','MARUTI','SUNPHARMA',
  'TITAN','BAJFINANCE','WIPRO','ULTRACEMCO','NTPC',
  'POWERGRID','ONGC','NESTLEIND','COALINDIA','JSWSTEEL',
  'TATAMOTORS','ADANIENT','ADANIPORTS','HINDALCO','GRASIM',
  'TATASTEEL','TECHM','HCLTECH','DRREDDY','DIVISLAB',
  'CIPLA','APOLLOHOSP','BAJAJFINSV','SBILIFE','HDFCLIFE',
  'EICHERMOT','HEROMOTOCO','BPCL','TATACONSUM','BRITANNIA',
  'UPL','SHREECEM','INDUSINDBK',
  // BANK NIFTY extras
  'BANDHANBNK','FEDERALBNK','IDFCFIRSTB','AUBANK',
]

const BANK_NIFTY_SET = new Set([
  'HDFCBANK','ICICIBANK','KOTAKBANK','AXISBANK',
  'SBIN','INDUSINDBK','BANDHANBNK','FEDERALBNK',
  'IDFCFIRSTB','AUBANK',
])

const SECTORS = {
  'RELIANCE':'Energy','TCS':'IT','HDFCBANK':'Banking',
  'INFY':'IT','ICICIBANK':'Banking','HINDUNILVR':'FMCG',
  'SBIN':'Banking','BHARTIARTL':'Telecom','ITC':'FMCG',
  'KOTAKBANK':'Banking','LT':'Infrastructure',
  'AXISBANK':'Banking','ASIANPAINT':'Paints',
  'MARUTI':'Auto','SUNPHARMA':'Pharma','TITAN':'Consumer',
  'BAJFINANCE':'Finance','WIPRO':'IT',
  'ULTRACEMCO':'Cement','NTPC':'Energy',
  'POWERGRID':'Energy','ONGC':'Energy',
  'NESTLEIND':'FMCG','COALINDIA':'Energy',
  'JSWSTEEL':'Metals','TATAMOTORS':'Auto',
  'ADANIENT':'Conglomerate','ADANIPORTS':'Infrastructure',
  'HINDALCO':'Metals','GRASIM':'Cement',
  'TATASTEEL':'Metals','TECHM':'IT','HCLTECH':'IT',
  'DRREDDY':'Pharma','DIVISLAB':'Pharma','CIPLA':'Pharma',
  'APOLLOHOSP':'Healthcare','BAJAJFINSV':'Finance',
  'SBILIFE':'Insurance','HDFCLIFE':'Insurance',
  'EICHERMOT':'Auto','HEROMOTOCO':'Auto','BPCL':'Energy',
  'TATACONSUM':'FMCG','BRITANNIA':'FMCG',
  'UPL':'Chemicals','SHREECEM':'Cement',
  'INDUSINDBK':'Banking','BANDHANBNK':'Banking',
  'FEDERALBNK':'Banking','IDFCFIRSTB':'Banking',
  'AUBANK':'Banking',
}

// GET /api/dashboard/market-scan
router.get('/market-scan', async (req, res) => {
  const cacheKey = 'finolens:market-scan'
  const cached = await cacheService.get(cacheKey)
  if (cached) return res.json({ ...cached, cached: true })

  try {
    const results = []
    const batchSize = 8

    for (let i = 0; i < FULL_UNIVERSE.length; i += batchSize) {
      const batch = FULL_UNIVERSE.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map(sym =>
          ML.get(`/technical/${sym}`)
            .then(r => ({ sym, data: r.data }))
            .catch(() => null)
        )
      )
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value)
        }
      }
    }

    const stocks = results.map(({ sym, data }) => ({
      symbol:          sym,
      sector:          SECTORS[sym] || 'Other',
      index:           BANK_NIFTY_SET.has(sym) ? 'BANKNIFTY' : 'NIFTY50',
      ltp:             data.current_price || 0,
      change_pct:      data.change_pct || 0,
      signal:          data.signal || 'NEUTRAL',
      technical_score: data.technical_score || 50,
      rsi:             data.rsi || 50,
      macd_bullish:    (data.macd_histogram || 0) > 0,
      above_vwap:      data.current_price > (data.vwap || 0),
      volume_ratio:    data.volume_ratio || 1,
      confidence:      data.confidence || 50,
      support:         data.support || 0,
      resistance:      data.resistance || 0,
    }))

    stocks.sort((a, b) => b.technical_score - a.technical_score)

    const bullish = stocks.filter(s => s.technical_score >= 58 || s.signal === 'BUY')
    const bearish = stocks.filter(s => s.technical_score <= 42 || s.signal === 'SELL')
    const neutral = stocks.filter(s =>
      s.technical_score > 42 && s.technical_score < 58 && s.signal === 'NEUTRAL'
    )

    const response = {
      all_stocks:     stocks,
      bullish:        bullish.slice(0, 15),
      bearish:        bearish.slice(0, 10),
      neutral:        neutral.slice(0, 10),
      total_bullish:  bullish.length,
      total_bearish:  bearish.length,
      total_neutral:  neutral.length,
      scan_time:      new Date().toISOString(),
    }

    await cacheService.set(cacheKey, response, 180)
    return res.json({ ...response, cached: false })
  } catch (err) {
    return res.status(502).json({ error: 'Market scan failed', detail: err.message })
  }
})

module.exports = router;
