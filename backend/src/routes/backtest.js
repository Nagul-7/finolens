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

function runCustomBacktest(bars, rules, capital, symbol = "NSE") {
  if (!bars || bars.length < 50) {
    return { win_rate: 0, total_trades: 0, avg_pnl: 0, max_drawdown: 0, sharpe_ratio: 0, equity_curve: [], trade_log: [] };
  }

  const closes  = bars.map((b) => parseFloat(b.close));
  const dates   = bars.map((b) => (b.timestamp || b.date || "").substring(0, 10));
  const volumes = bars.map((b) => parseFloat(b.volume || 0));

  const rsiArr  = computeRSI(closes);
  const histArr = computeMACDHist(closes);

  // EMA cross: EMA9 − EMA21
  const ema9  = computeEMA(closes, 9);
  const ema21 = computeEMA(closes, 21);
  const emaCrossArr = closes.map((_, i) => ema9[i] - ema21[i]);

  // Stochastic %K
  const kPeriod = 14;
  const stochKArr = closes.map((_, i) => {
    if (i < kPeriod - 1) return null;
    const slice = closes.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...slice), lo = Math.min(...slice);
    return hi === lo ? 50 : (closes[i] - lo) / (hi - lo) * 100;
  });

  // Bollinger Band position (0–100%)
  const bbPeriod = 20;
  const bbPosArr = closes.map((_, i) => {
    if (i < bbPeriod - 1) return null;
    const slice = closes.slice(i - bbPeriod + 1, i + 1);
    const mean  = slice.reduce((a, b) => a + b, 0) / bbPeriod;
    const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / bbPeriod);
    const upper = mean + 2 * std, lower = mean - 2 * std;
    return upper === lower ? 50 : (closes[i] - lower) / (upper - lower) * 100;
  });

  // Volume ratio vs 20-day average
  const volRatioArr = volumes.map((v, i) => {
    if (i < 20) return 1;
    const avg = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    return avg > 0 ? v / avg : 1;
  });

  // Price vs EMA20 percentage difference
  const ema20 = computeEMA(closes, 20);
  const priceVsEmaArr = closes.map((c, i) => ema20[i] > 0 ? (c - ema20[i]) / ema20[i] * 100 : 0);

  function getVal(indicator, i) {
    if (indicator === "rsi")          return rsiArr[i];
    if (indicator === "macd")         return histArr[i];
    if (indicator === "ema_cross")    return emaCrossArr[i];
    if (indicator === "stoch_k")      return stochKArr[i];
    if (indicator === "bb_position")  return bbPosArr[i];
    if (indicator === "volume_ratio") return volRatioArr[i];
    if (indicator === "price_vs_ema") return priceVsEmaArr[i];
    return null;
  }

  function check(indicator, operator, threshold, i) {
    const curr = getVal(indicator, i);
    const prev = getVal(indicator, i - 1);
    if (curr == null) return false;
    const t = parseFloat(threshold);
    if (operator === "below")         return curr < t;
    if (operator === "above")         return curr > t;
    if (operator === "crosses_above") return prev != null && prev <= t && curr > t;
    if (operator === "crosses_below") return prev != null && prev >= t && curr < t;
    return false;
  }

  const slPct = parseFloat(rules.stopLossPct || 2) / 100;
  const tpPct = parseFloat(rules.targetPct   || 5) / 100;

  let equity = capital;
  const trades = [];
  let position = null;
  const step = Math.floor(closes.length / 10);
  const checkpoints = new Set();
  for (let i = 0; i < closes.length; i += step) checkpoints.add(i);
  checkpoints.add(closes.length - 1);
  const equityCurve = [];

  for (let i = 35; i < closes.length; i++) {
    if (!position) {
      if (check(rules.entryIndicator, rules.entryOperator, rules.entryValue, i)) {
        const lotSize = Math.max(1, Math.floor((capital * 0.05) / closes[i]));
        position = { entry: closes[i], lotSize, date: dates[i] };
      }
    } else {
      const pnlPct = (closes[i] - position.entry) / position.entry;
      const exitByRule = check(rules.exitIndicator, rules.exitOperator, rules.exitValue, i);
      const exitBySL   = pnlPct <= -slPct;
      const exitByTP   = pnlPct >= tpPct;
      if (exitByRule || exitBySL || exitByTP || i === closes.length - 1) {
        const pnl = round2((closes[i] - position.entry) * position.lotSize);
        trades.push({ dt: position.date + " → " + dates[i], symbol, type: "LONG",
          entry: round2(position.entry), exit: round2(closes[i]), pnl, positive: pnl > 0 });
        equity += pnl;
        position = null;
      }
    }
    if (checkpoints.has(i)) {
      const label = dates[i]?.substring(0, 7) || `D${i}`;
      equityCurve.push({ t: label, strategy: round2((equity / capital) * 100), benchmark: round2(100 + (i / closes.length) * 28) });
    }
  }

  const wins    = trades.filter((t) => t.positive);
  const winRate = trades.length ? round2((wins.length / trades.length) * 100) : 0;
  const avgPnl  = trades.length ? Math.round(trades.reduce((s, t) => s + t.pnl, 0) / trades.length) : 0;
  let peak = capital, runCap = capital, maxDD = 0;
  for (const t of trades) {
    runCap += t.pnl;
    if (runCap > peak) peak = runCap;
    const dd = peak > 0 ? (peak - runCap) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  const returns  = trades.map((t) => t.pnl / capital);
  const avgR     = returns.reduce((s, v) => s + v, 0) / (returns.length || 1);
  const variance = returns.reduce((s, v) => s + (v - avgR) ** 2, 0) / (returns.length || 1);
  const sharpe   = variance > 0 ? round2((avgR / Math.sqrt(variance)) * Math.sqrt(252)) : 0;

  return { win_rate: winRate, total_trades: trades.length, avg_pnl: avgPnl,
    max_drawdown: round2(-maxDD), sharpe_ratio: sharpe, equity_curve: equityCurve,
    trade_log: trades.slice(-20).reverse() };
}

function runBacktest(bars, strategyName, capital, symbol = "NSE") {
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
          symbol,
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
  const { symbol = "NIFTY", strategy = "Mean Reversion (Nifty 50)", capital = 500000, custom_rules } = req.body;
  const from_date = req.body.from_date || req.body.from;
  const to_date   = req.body.to_date   || req.body.to;

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
      const { data } = await ML.get("/market/ohlcv/RELIANCE", { params });
      bars = data;
    }

    const result = strategy === "custom" && custom_rules
      ? runCustomBacktest(bars, custom_rules, Number(capital), sym)
      : runBacktest(bars, strategy, Number(capital), sym);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: "Backtest failed.", detail: err.message });
  }
});

module.exports = router;
