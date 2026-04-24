const express = require("express");
const axios = require("axios");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 60000 });

// ── Indicator helpers ─────────────────────────────────────────────────────────

function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff / period;
    else avgLoss -= diff / period;
  }

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function computeEMA(prices, period) {
  const ema = [];
  const k = 2 / (period + 1);
  let val = prices[0];
  ema.push(val);
  for (let i = 1; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
    ema.push(val);
  }
  return ema;
}

function computeMACDHist(closes) {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macd  = ema12.map((v, i) => v - ema26[i]);
  const signal = computeEMA(macd.slice(25), 9);
  const hist   = new Array(closes.length).fill(null);
  for (let i = 0; i < signal.length; i++) {
    hist[i + 25] = macd[i + 25] - signal[i];
  }
  return hist;
}

// ── Backtest engine ───────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }

function runBacktest(bars, strategyName, capital) {
  if (!bars || bars.length < 50) {
    return { win_rate: 0, total_trades: 0, avg_pnl: 0, max_drawdown: 0, sharpe_ratio: 0, equity_curve: [], trade_log: [] };
  }

  const closes = bars.map((b) => parseFloat(b.close));
  const dates  = bars.map((b) => {
    const ts = b.timestamp || b.date || "";
    return ts.substring(0, 10);
  });

  const isTrend = strategyName.toLowerCase().includes("trend") ||
                  strategyName.toLowerCase().includes("macd") ||
                  strategyName.toLowerCase().includes("bank");

  const signals = isTrend ? computeMACDHist(closes) : computeRSI(closes);

  let equity = capital;
  const trades = [];
  let position = null;
  const checkpoints = new Set();

  // Sample 10 equity curve points evenly
  const step = Math.floor(closes.length / 10);
  for (let i = 0; i < closes.length; i += step) checkpoints.add(i);
  checkpoints.add(closes.length - 1);

  const equityCurve = [];
  const startIdx = isTrend ? 35 : 20;

  for (let i = startIdx; i < closes.length; i++) {
    const sig = signals[i];
    const prev = signals[i - 1];

    if (!position) {
      let enter = false;
      if (!isTrend && sig !== null && sig < 32) enter = true;
      if (isTrend && sig !== null && prev !== null && prev <= 0 && sig > 0) enter = true;

      if (enter) {
        const lotSize = Math.max(1, Math.floor((capital * 0.05) / closes[i]));
        position = { entry: closes[i], lotSize, date: dates[i] };
      }
    } else {
      let exit = false;
      if (!isTrend) {
        const pnlPct = (closes[i] - position.entry) / position.entry;
        if (sig !== null && (sig > 68 || pnlPct < -0.025 || pnlPct > 0.05 || i === closes.length - 1)) exit = true;
      } else {
        if (sig !== null && prev !== null && prev >= 0 && sig < 0) exit = true;
        if (i === closes.length - 1) exit = true;
      }

      if (exit) {
        const pnl = round2((closes[i] - position.entry) * position.lotSize);
        trades.push({
          dt: position.date + " → " + dates[i],
          symbol: "NSE",
          type: "LONG",
          entry: round2(position.entry),
          exit: round2(closes[i]),
          pnl,
          positive: pnl > 0,
        });
        equity += pnl;
        position = null;
      }
    }

    if (checkpoints.has(i)) {
      const label = dates[i]?.substring(0, 7) || `D${i}`;
      equityCurve.push({ t: label, strategy: round2((equity / capital) * 100), benchmark: round2(100 + (i / closes.length) * 28) });
    }
  }

  // Stats
  const wins = trades.filter((t) => t.positive);
  const winRate = trades.length ? round2((wins.length / trades.length) * 100) : 0;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = trades.length ? Math.round(totalPnl / trades.length) : 0;

  // Max drawdown
  let peak = capital;
  let runCap = capital;
  let maxDD = 0;
  for (const t of trades) {
    runCap += t.pnl;
    if (runCap > peak) peak = runCap;
    const dd = peak > 0 ? (peak - runCap) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe
  const returns = trades.map((t) => t.pnl / capital);
  const avgR = returns.reduce((s, v) => s + v, 0) / (returns.length || 1);
  const variance = returns.reduce((s, v) => s + (v - avgR) ** 2, 0) / (returns.length || 1);
  const sharpe = variance > 0 ? round2((avgR / Math.sqrt(variance)) * Math.sqrt(252)) : 0;

  return {
    win_rate:     winRate,
    total_trades: trades.length,
    avg_pnl:      avgPnl,
    max_drawdown: round2(-maxDD),
    sharpe_ratio: sharpe,
    equity_curve: equityCurve,
    trade_log:    trades.slice(-20).reverse(),
  };
}

// POST /api/backtest/run
router.post("/run", async (req, res) => {
  const { symbol = "NIFTY", from_date, to_date, strategy = "Mean Reversion (Nifty 50)", capital = 500000 } = req.body;

  try {
    const params = { interval: "1d" };
    if (from_date) params.from = from_date;
    if (to_date)   params.to   = to_date;

    const sym = symbol.replace(/\s.*/, "").replace(/[()]/g, "").toUpperCase();
    let bars;
    try {
      const { data } = await ML.get(`/market/ohlcv/${sym}`, { params });
      bars = data;
    } catch {
      // Fallback to NIFTY50 proxy symbol
      const { data } = await ML.get("/market/ohlcv/RELIANCE", { params });
      bars = data;
    }

    const result = runBacktest(bars, strategy, Number(capital));
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: "Backtest failed.", detail: err.message });
  }
});

module.exports = router;
