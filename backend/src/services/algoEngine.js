"use strict";
/**
 * AlgoEngine — production multi-strategy execution loop.
 *
 * 5 registered strategies: Multi-Factor Momentum, SuperTrend + EMA Confluence,
 * Weekly Range Breakout, Dual Timeframe Trend Confirmation, Mean Reversion RSI.
 *
 * Ticks every 5 minutes during NSE market hours (9:15–15:30 IST, weekdays).
 * Runs alignment scan at 9:20 AM IST on weekdays across 50+ stocks.
 */

const { v4: uuidv4 }  = require("uuid");
const axios           = require("axios");
const mlService       = require("./mlService");
const brokerClient    = require("./brokerClient");

const ML = axios.create({
  baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000",
  timeout: 30_000,
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1D: MATHEMATICAL HELPERS
// Pure functions — no external TA library, no side effects.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wilder's smoothed RSI.
 * Matches indicators.py: gain.ewm(alpha=1/period, adjust=False).mean()
 * Seed: simple average of first `period` changes, then Wilder smoothing.
 */
function computeRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff / period;
    else          avgLoss -= diff / period;
  }
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff,  0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

/**
 * Standard EMA — multiplier k = 2/(period+1).
 * Matches indicators.py: prices.ewm(span=period, adjust=False).mean()
 * Returns an array the same length as prices (never null).
 */
function computeEMA(prices, period) {
  if (!prices || prices.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [];
  let val = prices[0];
  result.push(val);
  for (let i = 1; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
    result.push(val);
  }
  return result;
}

/**
 * MACD — returns { macdLine, signalLine, histogram }.
 * histogram[i] is null for i < slow-1 (before first reliable MACD value).
 * Matches indicators.py: ewm(span=fast/slow/signal, adjust=False).
 */
function computeMACD(closes, fast = 12, slow = 26, sigPeriod = 9) {
  const emaFast  = computeEMA(closes, fast);
  const emaSlow  = computeEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);

  // Signal EMA: computed on macdLine starting at index slow-1 (first meaningful MACD)
  const signalArr  = computeEMA(macdLine.slice(slow - 1), sigPeriod);
  const signalLine = new Array(closes.length).fill(null);
  const histogram  = new Array(closes.length).fill(null);

  for (let i = 0; i < signalArr.length; i++) {
    const idx       = i + slow - 1;
    signalLine[idx] = signalArr[i];
    histogram[idx]  = macdLine[idx] - signalArr[i];
  }
  return { macdLine, signalLine, histogram };
}

/**
 * Bollinger Bands — population std dev (ddof=0).
 * Matches indicators.py: rolling(window).std(ddof=0).
 * Returns array of { upper, mid, lower }; null before period-1.
 */
function computeBB(closes, period = 20, mult = 2) {
  const result = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice    = closes.slice(i - period + 1, i + 1);
    const mean     = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std      = Math.sqrt(variance);
    result[i]      = { upper: mean + mult * std, mid: mean, lower: mean - mult * std };
  }
  return result;
}

/**
 * Average True Range — Wilder's method.
 * Seed: simple average of first `period` true ranges.
 * result[i] is null for i < period.
 */
function computeATR(bars, period = 14) {
  const result = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return result;

  const tr = [0]; // index 0 has no prior close; placeholder
  for (let i = 1; i < bars.length; i++) {
    const h  = parseFloat(bars[i].high);
    const l  = parseFloat(bars[i].low);
    const pc = parseFloat(bars[i - 1].close);
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  // Seed ATR: simple average of first `period` true ranges
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr[i];
  atr /= period;
  result[period] = atr;

  for (let i = period + 1; i < bars.length; i++) {
    atr       = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

/**
 * SuperTrend — ATR-based trailing stop/direction indicator.
 * Returns array of { value, direction } where direction: 1=bullish, -1=bearish.
 * null before index `period`.
 *
 * Algorithm:
 *  basic_upper = hl2 + mult * ATR
 *  basic_lower = hl2 - mult * ATR
 *  final_upper = min(basic_upper, prev_final_upper) if prev_close <= prev_final_upper
 *  final_lower = max(basic_lower, prev_final_lower) if prev_close >= prev_final_lower
 *  direction flips when close crosses the active band.
 */
function computeSuperTrend(bars, period = 10, mult = 3) {
  const result = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return result;

  const atrArr = computeATR(bars, period);

  let finalUpper = 0;
  let finalLower = 0;
  let direction  = 1;   // 1=bullish, -1=bearish
  let supertrend = 0;

  for (let i = period; i < bars.length; i++) {
    const hl2 = (parseFloat(bars[i].high) + parseFloat(bars[i].low)) / 2;
    const atr  = atrArr[i] ?? 0;
    const bu   = hl2 + mult * atr;
    const bl   = hl2 - mult * atr;

    const prevClose      = parseFloat(bars[i - 1].close);
    const prevFinalUpper = finalUpper;
    const prevFinalLower = finalLower;
    const prevDirection  = direction;

    if (i === period) {
      finalUpper = bu;
      finalLower = bl;
    } else {
      // Upper tightens downward; resets if close exceeded it
      finalUpper = (bu < prevFinalUpper || prevClose > prevFinalUpper)
        ? bu : prevFinalUpper;
      // Lower tightens upward; resets if close fell below it
      finalLower = (bl > prevFinalLower || prevClose < prevFinalLower)
        ? bl : prevFinalLower;
    }

    const close = parseFloat(bars[i].close);

    if (i === period) {
      direction  = close > finalLower ? 1 : -1;
      supertrend = direction === 1 ? finalLower : finalUpper;
    } else if (prevDirection === 1) {
      // Was bullish — flip bearish if close falls below lower band
      if (close < finalLower) {
        direction  = -1;
        supertrend = finalUpper;
      } else {
        direction  = 1;
        supertrend = finalLower;
      }
    } else {
      // Was bearish — flip bullish if close rises above upper band
      if (close > finalUpper) {
        direction  = 1;
        supertrend = finalLower;
      } else {
        direction  = -1;
        supertrend = finalUpper;
      }
    }

    result[i] = { value: +supertrend.toFixed(2), direction };
  }
  return result;
}

/**
 * Swing high/low over the most recent `lookback` bars.
 * Returns { swing_high, swing_low }.
 */
function detectSwingHighLow(highs, lows, lookback = 20) {
  const n     = highs.length;
  const start = Math.max(0, n - lookback);
  let swingHigh = -Infinity;
  let swingLow  =  Infinity;
  for (let i = start; i < n; i++) {
    if (highs[i] > swingHigh) swingHigh = highs[i];
    if (lows[i]  < swingLow)  swingLow  = lows[i];
  }
  return { swing_high: swingHigh, swing_low: swingLow };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1A: STRATEGY REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

const STRATEGY_REGISTRY = [
  {
    id:          "multi_momentum",
    name:        "Multi-Factor Momentum",
    status:      "ACTIVE",
    description: "Buys stocks in uptrend with fresh momentum and institutional volume. Holds 3–7 days.",
    when_to_use: "Use in bull markets and sideways markets. Best when NIFTY50 weekly trend is up. Works best in trending sectors like IT and Banking.",
    when_not_to_use: "Avoid during earnings season for the specific stock. Avoid when NIFTY50 is in a strong downtrend (below weekly EMA50). Avoid on days with major macro events (RBI policy, budget, US Fed meetings).",
    best_stocks: "Large cap NIFTY50 stocks with high liquidity. Best performers: HDFCBANK, RELIANCE, TCS, INFY, ICICIBANK.",
    timeframe:   "Daily chart entry, weekly bias check",
    win_rate:    "54–62%",
    parameters: {
      rsi_min:          40,
      rsi_max:          60,
      ema_period:       200,
      macd_lookback:    3,
      volume_ratio_min: 1.5,
      hold_days_max:    7,
      target_pct:       5.0,
      sl_pct:           2.5,
    },
    entry_conditions: [
      "RSI between rsi_min and rsi_max",
      "Price above EMA200",
      "MACD histogram turned positive within last macd_lookback candles",
      "Volume ratio >= volume_ratio_min",
    ],
    exit_conditions: [
      "Price hits target_pct above entry",
      "Price hits sl_pct below entry",
      "RSI crosses above 70 (overbought exit)",
      "Held for hold_days_max days",
    ],
    risk_profile: "moderate",
  },

  {
    id:          "supertrend_confluence",
    name:        "SuperTrend + EMA Confluence",
    status:      "ACTIVE",
    description: "Enters when SuperTrend flips bullish AND price is above EMA21 AND EMA9 > EMA21. Dynamic stop loss follows SuperTrend line.",
    when_to_use: "Excellent in trending markets. Best after a consolidation phase when a stock breaks out with volume. Works on all NIFTY50 stocks. Best timeframe is daily.",
    when_not_to_use: "Avoid in choppy/sideways markets (SuperTrend gives many false signals in ranging conditions). Check ATR — if ATR is very low, market is too quiet for this strategy. Avoid when stock has upcoming earnings.",
    best_stocks: "High ATR stocks that trend well. TATAMOTORS, BAJFINANCE, ADANIENT, TATASTEEL, MARUTI respond best to SuperTrend strategies.",
    timeframe:   "Daily chart",
    win_rate:    "56–64%",
    parameters: {
      st_period:         10,
      st_multiplier:     3.0,
      ema_fast:          9,
      ema_slow:          21,
      rsi_min:           45,
      rsi_max:           65,
      volume_ratio_min:  1.0,
      target_multiplier: 2.0,
      trailing_sl:       true,
      sl_pct:            3.0,
      target_pct:        6.0,
      hold_days_max:     10,
    },
    entry_conditions: [
      "SuperTrend just flipped from red to green (previous bearish, current bullish)",
      "Price > EMA21",
      "EMA9 > EMA21",
      "RSI between rsi_min and rsi_max",
      "Volume >= volume_ratio_min times 20-day average",
    ],
    exit_conditions: [
      "SuperTrend flips back to red",
      "Price hits 2x the initial risk above entry",
      "RSI > 75",
    ],
    risk_profile: "moderate",
  },

  {
    id:          "weekly_breakout",
    name:        "Weekly Range Breakout",
    status:      "ACTIVE",
    description: "Buys when price breaks above the previous week high with strong volume. Targets 1.5x the previous week range. Holds 3–5 days.",
    when_to_use: "Best on Tuesday and Wednesday when Monday has confirmed the breakout. Strongest signal when the breakout happens after 3+ weeks of consolidation in a narrow range. Works best in bull market conditions.",
    when_not_to_use: "Never trade breakouts on Monday (too many false gaps). Avoid if the previous week was an extremely wide range candle (already moved too much). Avoid in bear markets where breakouts fail quickly.",
    best_stocks: "Stocks near 52-week highs with strong fundamentals. HDFCBANK, ICICIBANK, AXISBANK, KOTAKBANK break out cleanly. Avoid penny stocks and low liquidity names.",
    timeframe:   "Weekly chart for levels, daily for entry",
    win_rate:    "48–58%",
    parameters: {
      volume_ratio_min:          1.8,
      hold_days_max:             5,
      target_multiplier:         1.5,
      sl_pct:                    2.0,
      target_pct:                4.0,
      min_consolidation_candles: 3,
    },
    entry_conditions: [
      "Current price > previous week high",
      "Volume ratio >= 1.8",
      "Day of week is Tuesday, Wednesday, or Thursday",
      "Previous 3+ weekly candles in narrow range (high-low < 3% of price)",
    ],
    exit_conditions: [
      "Price hits 1.5x previous week range above entry",
      "Price falls back below previous week high (failed breakout)",
      "Held for hold_days_max days",
    ],
    risk_profile: "aggressive",
  },

  {
    id:          "dual_timeframe",
    name:        "Dual Timeframe Trend Confirmation",
    status:      "ACTIVE",
    description: "Weekly timeframe sets direction bias. Daily timeframe provides precise entry when price pulls back to EMA21 in an uptrend. Highest win rate of all 5 strategies at 62–68%.",
    when_to_use: "This is the primary strategy. Use in all market conditions where NIFTY50 weekly EMA21 is sloping upward. Best for patient swing traders who can hold 5–10 days. Perfect for stocks in strong sectors.",
    when_not_to_use: "Do not use when weekly EMA21 is sloping down (weekly downtrend). Do not use when price is extended far above EMA21 (buy the dip, not the top). Requires patience — do not use if you cannot hold for at least 3 days.",
    best_stocks: "Blue chip NIFTY50 stocks with strong earnings history. TCS, INFY, HDFCBANK, RELIANCE, ICICIBANK. Also works on NIFTY index ETFs like NIFTYBEES.",
    timeframe:   "Weekly bias + Daily entry",
    win_rate:    "62–68%",
    parameters: {
      weekly_ema:         21,
      daily_ema:          21,
      daily_ema_fast:     9,
      rsi_min:            45,
      rsi_max:            58,
      macd_hist_positive: true,
      volume_ratio_min:   1.3,
      max_hold_days:      10,
      target_pct:         7.0,
      sl_pct:             2.5,
      trailing_sl:        true,
      trailing_sl_pct:    1.5,
    },
    entry_conditions: [
      "Weekly EMA21 slope is positive (current week EMA > previous week EMA)",
      "Weekly RSI > 50",
      "Daily SuperTrend is green",
      "Daily price pulled back to within 1% of daily EMA21 and is bouncing",
      "Daily RSI between rsi_min and rsi_max",
      "Daily MACD histogram is positive",
      "Volume ratio >= volume_ratio_min",
    ],
    exit_conditions: [
      "Price hits target_pct above entry",
      "Price hits sl_pct below entry",
      "Trailing SL hit (peak_price * (1 - trailing_sl_pct/100))",
      "Weekly EMA21 slope turns negative",
      "Held for max_hold_days",
    ],
    risk_profile: "moderate",
  },

  {
    id:          "mean_reversion",
    name:        "Mean Reversion RSI",
    status:      "ACTIVE",
    description: "Buys heavily oversold stocks that show signs of recovery. Uses RSI + BB lower band touch + positive MACD histogram as confirmation. Short hold 2–4 days targeting snap-back to mean.",
    when_to_use: "Best in sideways or mildly bullish markets. Use after a sharp 3–5 day selloff in an otherwise strong stock. Best when the broader market (NIFTY50) is stable or recovering. High win rate in range-bound markets.",
    when_not_to_use: "Never use in a strong downtrend — oversold can get more oversold. Do not use on stocks with fundamental problems (earnings miss, regulatory issues). Do not use when market volatility (VIX) is above 20 as oversold bounces fail in high volatility.",
    best_stocks: "Quality NIFTY50 stocks that sold off due to market panic not company-specific issues. HINDUNILVR, NESTLEIND, BRITANNIA, SUNPHARMA show reliable mean reversion patterns.",
    timeframe:   "Daily chart",
    win_rate:    "58–66%",
    parameters: {
      rsi_oversold:       32,
      bb_position_max:    20,
      macd_hist_positive: true,
      volume_ratio_min:   1.2,
      hold_days_max:      4,
      target_pct:         3.0,
      sl_pct:             2.0,
    },
    entry_conditions: [
      "RSI <= rsi_oversold",
      "BB position <= bb_position_max (lower 20% of band)",
      "MACD histogram positive (momentum turning up)",
      "Volume ratio >= volume_ratio_min",
    ],
    exit_conditions: [
      "Price hits target_pct above entry",
      "Price hits sl_pct below entry",
      "RSI crosses above 55 (mean restored)",
      "Held for hold_days_max days",
    ],
    risk_profile: "conservative",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SCAN UNIVERSE  (NIFTY50 + key Bank Nifty constituents)
// ─────────────────────────────────────────────────────────────────────────────

const SCAN_UNIVERSE = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK",
  "LT", "AXISBANK", "ASIANPAINT", "MARUTI", "SUNPHARMA",
  "TITAN", "BAJFINANCE", "WIPRO", "ULTRACEMCO", "NTPC",
  "POWERGRID", "ONGC", "NESTLEIND", "COALINDIA", "JSWSTEEL",
  "TATAMOTORS", "ADANIENT", "ADANIPORTS", "HINDALCO",
  "GRASIM", "TATASTEEL", "TECHM", "HCLTECH", "DRREDDY",
  "DIVISLAB", "CIPLA", "APOLLOHOSP", "BAJAJFINSV",
  "SBILIFE", "HDFCLIFE", "EICHERMOT", "HEROMOTOCO",
  "BPCL", "TATACONSUM", "BRITANNIA", "SHREECEM",
  "INDUSINDBK", "M&M",
  // Bank Nifty additions
  "BANDHANBNK", "FEDERALBNK", "IDFCFIRSTB", "AUBANK",
];

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STATE  (shared with algo.js routes)
// ─────────────────────────────────────────────────────────────────────────────

// Pre-populated with one instance per strategy; users can add more via routes.
const _strategies = [
  {
    id: "1", name: "Dual Timeframe Trend", status: "ACTIVE", mode: "PAPER",
    strategy_type: "dual_timeframe",
    capital: 500000, capital_per_trade: 100000,
    max_concurrent: 3, max_trades: 10,
    daily_loss_limit: 15000,
    today_pnl: 0, trades_today: 0,
    created_at: new Date().toISOString(),
  },
  {
    id: "2", name: "Multi-Factor Momentum", status: "PAUSED", mode: "PAPER",
    strategy_type: "multi_momentum",
    capital: 500000, capital_per_trade: 100000,
    max_concurrent: 3, max_trades: 10,
    daily_loss_limit: 15000,
    today_pnl: 0, trades_today: 0,
    created_at: new Date().toISOString(),
  },
  {
    id: "3", name: "Mean Reversion RSI", status: "PAUSED", mode: "PAPER",
    strategy_type: "mean_reversion",
    capital: 250000, capital_per_trade: 62500,
    max_concurrent: 2, max_trades: 8,
    daily_loss_limit: 10000,
    today_pnl: 0, trades_today: 0,
    created_at: new Date().toISOString(),
  },
  {
    id: "4", name: "SuperTrend Confluence", status: "PAUSED", mode: "PAPER",
    strategy_type: "supertrend_confluence",
    capital: 500000, capital_per_trade: 100000,
    max_concurrent: 3, max_trades: 10,
    daily_loss_limit: 15000,
    today_pnl: 0, trades_today: 0,
    created_at: new Date().toISOString(),
  },
  {
    id: "5", name: "Weekly Range Breakout", status: "PAUSED", mode: "PAPER",
    strategy_type: "weekly_breakout",
    capital: 300000, capital_per_trade: 75000,
    max_concurrent: 2, max_trades: 6,
    daily_loss_limit: 12000,
    today_pnl: 0, trades_today: 0,
    created_at: new Date().toISOString(),
  },
];

const _openPositions  = [];  // { id, strategy_id, symbol, side, qty, entry_price, ... }
const _closedTrades   = [];  // { ...position, exit_price, exit_time, exit_reason, pnl }
const _engineLogs     = [];  // { ts, level, msg }
let   _alignmentResults = [];
let   _lastScanTime     = null;
let   _io               = null;

// ─────────────────────────────────────────────────────────────────────────────
// MARKET HOURS (IST)
// ─────────────────────────────────────────────────────────────────────────────

function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day  = ist.getDay();            // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930;    // 9:15 → 15:30
}

function getTodayIST() {
  return new Date()
    .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    .split(",")[0];
}

function getDailyPnl(strategyId) {
  const today    = getTodayIST();
  const realized = _closedTrades
    .filter(t => t.strategy_id === strategyId &&
      new Date(t.exit_time)
        .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
        .startsWith(today))
    .reduce((sum, t) => sum + (t.pnl || 0), 0);
  const unrealized = _openPositions
    .filter(p => p.strategy_id === strategyId)
    .reduce((sum, p) => sum + (p.pnl || 0), 0);
  return { realized, unrealized, total: realized + unrealized };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1C: checkStrategyAlignment
// ─────────────────────────────────────────────────────────────────────────────

function checkStrategyAlignment(strategy, dailyBars, weeklyBars, symbol) {
  if (!dailyBars || dailyBars.length < 30) {
    return { score: 0, reasons: ["Insufficient daily data"], suggested_sl: 0, suggested_target: 0 };
  }

  const closes = dailyBars.map(b => parseFloat(b.close));
  const highs  = dailyBars.map(b => parseFloat(b.high));
  const lows   = dailyBars.map(b => parseFloat(b.low));
  const vols   = dailyBars.map(b => parseFloat(b.volume || 0));

  const p       = strategy.parameters;
  const reasons = [];
  let   score   = 0;

  // ── Core indicators ──────────────────────────────────────────────────────
  const rsiArr = computeRSI(closes, 14);
  const curRSI = rsiArr[rsiArr.length - 1] ?? 50;

  const ema9   = computeEMA(closes, 9);
  const ema21  = computeEMA(closes, 21);
  const ema200 = computeEMA(closes, 200);

  const { histogram } = computeMACD(closes);
  const curHist  = histogram[histogram.length - 1]  ?? 0;
  const prevHist = histogram[histogram.length - 2]  ?? 0;

  const bb    = computeBB(closes, 20, 2);
  const curBB = bb[bb.length - 1];
  const curPrice = closes[closes.length - 1];
  const bbPos = curBB && (curBB.upper - curBB.lower) > 0
    ? (curPrice - curBB.lower) / (curBB.upper - curBB.lower) * 100
    : 50;

  const avgVol   = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgVol > 0 ? vols[vols.length - 1] / avgVol : 1;

  const stArr  = computeSuperTrend(dailyBars, p.st_period || 10, p.st_multiplier || 3);
  const curST  = stArr[stArr.length - 1];
  const prevST = stArr[stArr.length - 2];

  // ── Weekly indicators ─────────────────────────────────────────────────────
  const wCloses   = (weeklyBars || []).map(b => parseFloat(b.close));
  const wEma21    = wCloses.length >= 2  ? computeEMA(wCloses, 21) : [];
  const wRsiArr   = wCloses.length >= 15 ? computeRSI(wCloses, 14) : [];
  const wEmaSlope = wEma21.length >= 2
    ? wEma21[wEma21.length - 1] - wEma21[wEma21.length - 2]
    : 0;
  const curWRsi = wRsiArr.length > 0 ? (wRsiArr[wRsiArr.length - 1] ?? 50) : 50;

  // ── Strategy-specific scoring ─────────────────────────────────────────────

  if (strategy.id === "multi_momentum") {
    if (curRSI >= p.rsi_min && curRSI <= p.rsi_max) {
      score += 20;
      reasons.push(`RSI ${curRSI.toFixed(1)} in momentum zone (${p.rsi_min}–${p.rsi_max})`);
    }
    if (curPrice > ema200[ema200.length - 1]) {
      score += 20;
      reasons.push("Price above EMA200 — long-term uptrend confirmed");
    }
    // MACD histogram turned positive within last macd_lookback candles
    const recentHist = histogram
      .slice(-(p.macd_lookback || 3))
      .filter(v => v !== null);
    const macdFlipped = recentHist.some(
      (v, i) => i > 0 && recentHist[i - 1] <= 0 && v > 0
    );
    if (macdFlipped || curHist > 0) {
      score += 20;
      reasons.push("MACD momentum turning bullish");
    }
    if (volRatio >= p.volume_ratio_min) {
      score += 20;
      reasons.push(`Volume ${volRatio.toFixed(1)}× above average (institutional interest)`);
    }
    if (wEmaSlope > 0) {
      score += 20;
      reasons.push("Weekly trend is up — EMA21 sloping positive");
    }
  }

  else if (strategy.id === "supertrend_confluence") {
    const stFlipped = prevST?.direction === -1 && curST?.direction === 1;
    if (stFlipped) {
      score += 25;
      reasons.push("SuperTrend just flipped bullish — fresh trend signal");
    } else if (curST?.direction === 1) {
      score += 10;
      reasons.push("SuperTrend is bullish");
    }
    if (curPrice > ema21[ema21.length - 1]) {
      score += 20;
      reasons.push("Price above EMA21");
    }
    if (ema9[ema9.length - 1] > ema21[ema21.length - 1]) {
      score += 20;
      reasons.push("EMA9 above EMA21 — momentum alignment confirmed");
    }
    if (curRSI >= p.rsi_min && curRSI <= p.rsi_max) {
      score += 20;
      reasons.push(`RSI ${curRSI.toFixed(1)} in optimal entry range (${p.rsi_min}–${p.rsi_max})`);
    }
    if (volRatio >= p.volume_ratio_min) {
      score += 15;
      reasons.push("Volume confirming move");
    }
  }

  else if (strategy.id === "dual_timeframe") {
    if (wEmaSlope > 0) {
      score += 25;
      reasons.push("Weekly EMA21 sloping up — macro uptrend confirmed");
    }
    if (curWRsi > 50) {
      score += 15;
      reasons.push(`Weekly RSI ${curWRsi.toFixed(1)} > 50 — weekly momentum bullish`);
    }
    if (curST?.direction === 1) {
      score += 15;
      reasons.push("Daily SuperTrend bullish");
    }
    const ema21Val  = ema21[ema21.length - 1];
    const nearEMA21 = ema21Val > 0
      ? Math.abs(curPrice - ema21Val) / ema21Val < 0.015
      : false;
    if (nearEMA21) {
      score += 20;
      reasons.push("Price near EMA21 — optimal entry, not overextended");
    }
    if (curRSI >= p.rsi_min && curRSI <= p.rsi_max) {
      score += 15;
      reasons.push(`RSI ${curRSI.toFixed(1)} optimal for entry`);
    }
    if (curHist > 0) {
      score += 10;
      reasons.push("MACD momentum positive");
    }
  }

  else if (strategy.id === "mean_reversion") {
    if (curRSI <= p.rsi_oversold) {
      score += 30;
      reasons.push(`RSI ${curRSI.toFixed(1)} deeply oversold — snap-back likely`);
    }
    if (bbPos <= p.bb_position_max) {
      score += 25;
      reasons.push(`Price at lower Bollinger Band (${bbPos.toFixed(1)}% position) — statistical edge`);
    }
    if (curHist > 0 && prevHist <= 0) {
      score += 25;
      reasons.push("MACD just turned positive — recovery momentum starting");
    } else if (curHist > 0) {
      score += 10;
      reasons.push("MACD positive");
    }
    if (volRatio >= p.volume_ratio_min) {
      score += 20;
      reasons.push("Volume spike confirms capitulation/reversal");
    }
  }

  else if (strategy.id === "weekly_breakout") {
    if (!weeklyBars || weeklyBars.length < 4) {
      return { score: 0, reasons: ["Insufficient weekly data for breakout check"], suggested_sl: 0, suggested_target: 0 };
    }
    const wHighs    = weeklyBars.map(b => parseFloat(b.high));
    const wLowsArr  = weeklyBars.map(b => parseFloat(b.low));
    const prevWHigh = wHighs[wHighs.length - 2];
    const prevWLow  = wLowsArr[wLowsArr.length - 2];
    const weekRange    = prevWHigh - prevWLow;
    const weekRangePct = prevWHigh > 0 ? weekRange / prevWHigh : 0;

    if (curPrice > prevWHigh) {
      score += 35;
      reasons.push(`Price broke above last week high ₹${prevWHigh.toFixed(2)}`);
    }
    if (volRatio >= p.volume_ratio_min) {
      score += 30;
      reasons.push(`Volume ${volRatio.toFixed(1)}× confirming breakout`);
    }
    if (weekRangePct > 0 && weekRangePct < 0.04) {
      score += 20;
      reasons.push("Broke from tight consolidation — high probability breakout");
    }
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
      score += 15;
      reasons.push("Optimal breakout day (Tue/Wed/Thu)");
    }
  }

  const suggested_sl     = +(curPrice * (1 - (p.sl_pct || 2.5) / 100)).toFixed(2);
  const suggested_target = +(curPrice * (1 + (p.target_pct || 5.0) / 100)).toFixed(2);

  // Score is designed to max at 100 per strategy — clamp and round.
  const normalizedScore = Math.min(100, Math.round(score));

  return { score: normalizedScore, reasons, suggested_sl, suggested_target };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1B: scanStockAlignment  (runs at 9:20 AM IST on weekdays)
// ─────────────────────────────────────────────────────────────────────────────

async function scanStockAlignment() {
  _log("INFO", `[scan] Starting alignment scan — ${SCAN_UNIVERSE.length} symbols × ${STRATEGY_REGISTRY.length} strategies`);

  const alignments = [];

  for (const symbol of SCAN_UNIVERSE) {
    try {
      const [dailyRes, weeklyRes] = await Promise.all([
        ML.get(`/market/ohlcv/${symbol}`, { params: { interval: "1d",  period: "6mo" } }),
        ML.get(`/market/ohlcv/${symbol}`, { params: { interval: "1wk", period: "2y"  } }),
      ]);

      const dailyBars  = dailyRes.data;
      const weeklyBars = weeklyRes.data;
      if (!dailyBars || dailyBars.length < 30) continue;

      for (const strategy of STRATEGY_REGISTRY) {
        if (strategy.status !== "ACTIVE") continue;

        const aligned = checkStrategyAlignment(strategy, dailyBars, weeklyBars, symbol);

        if (aligned.score >= 70) {
          alignments.push({
            symbol,
            strategy_id:      strategy.id,
            strategy_name:    strategy.name,
            risk_profile:     strategy.risk_profile,
            alignment_score:  aligned.score,
            reasons:          aligned.reasons,
            entry_price:      +parseFloat(dailyBars[dailyBars.length - 1]?.close ?? 0).toFixed(2),
            suggested_sl:     aligned.suggested_sl,
            suggested_target: aligned.suggested_target,
            risk_reward:      aligned.suggested_sl > 0
              ? `1:${((aligned.suggested_target - parseFloat(dailyBars[dailyBars.length-1]?.close ?? 0)) / (parseFloat(dailyBars[dailyBars.length-1]?.close ?? 0) - aligned.suggested_sl)).toFixed(1)}`
              : "1:2",
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      _log("WARN", `[scan] ${symbol} failed: ${e.message}`);
    }
  }

  alignments.sort((a, b) => b.alignment_score - a.alignment_score);

  _alignmentResults = alignments;
  _lastScanTime     = new Date().toISOString();

  if (_io && alignments.length > 0) {
    // Broadcast top 10 to all connected clients
    _io.emit("strategy_alignments", {
      alignments:  alignments.slice(0, 10),
      scan_time:   _lastScanTime,
      total_found: alignments.length,
    });

    // scan_complete event for the alerts panel
    _io.emit("scan_complete", {
      total_scanned:    SCAN_UNIVERSE.length,
      alignments_found: alignments.length,
      top_picks:        alignments.slice(0, 5),
    });

    // Individual high-confidence alerts (score >= 85)
    for (const a of alignments.filter(x => x.alignment_score >= 85)) {
      _io.emit("strategy_alert", {
        type:             "STRATEGY_ALIGNMENT",
        symbol:           a.symbol,
        strategy:         a.strategy_name,
        strategy_id:      a.strategy_id,
        alignment_score:  a.alignment_score,
        reasons:          a.reasons,
        entry_price:      a.entry_price,
        suggested_sl:     a.suggested_sl,
        suggested_target: a.suggested_target,
        risk_reward:      a.risk_reward,
        message:          `${a.symbol} is highly aligned with ${a.strategy_name} (${a.alignment_score}% match)`,
        timestamp:        new Date().toISOString(),
      });
    }
  }

  _log("INFO", `[scan] Completed — ${alignments.length} alignments found across ${SCAN_UNIVERSE.length} stocks`);
  return alignments;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────────────────────

function _log(level, msg) {
  _engineLogs.unshift({ ts: new Date().toISOString(), level, msg });
  if (_engineLogs.length > 200) _engineLogs.length = 200;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1E + 1F: CORE ENGINE
// ─────────────────────────────────────────────────────────────────────────────

const algoEngine = {
  _interval:     null,
  _scanInterval: null,

  // ── Section 1F: start ────────────────────────────────────────────────────
  start(io) {
    _io = io || null;
    if (this._interval) return; // already running

    // Main execution tick: every 5 minutes during market hours
    this._interval = setInterval(() => this._tick(), 5 * 60 * 1000);

    // Stock alignment scan: every day at 9:20 AM IST
    // Check every minute; fire once in the 9:20–9:25 window on weekdays
    this._scanInterval = setInterval(() => {
      const now = new Date();
      const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const day = ist.getDay();
      const h   = ist.getHours();
      const m   = ist.getMinutes();
      if (day >= 1 && day <= 5 && h === 9 && m >= 20 && m <= 25) {
        // Guard: only run once per window (check if last scan was today)
        if (_lastScanTime) {
          const lastScanIST = new Date(_lastScanTime)
            .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
            .split(",")[0];
          if (lastScanIST === getTodayIST()) return;
        }
        scanStockAlignment().catch(e =>
          _log("ERROR", `[scan] Failed: ${e.message}`)
        );
      }
    }, 60 * 1000);

    _log("INFO", "AlgoEngine started — 5 strategies loaded, 5-minute execution loop active");
    console.log("[AlgoEngine] Started with 5 strategies");
  },

  stop() {
    if (this._interval)     { clearInterval(this._interval);     this._interval     = null; }
    if (this._scanInterval) { clearInterval(this._scanInterval); this._scanInterval = null; }
    _log("INFO", "AlgoEngine stopped");
    console.log("[AlgoEngine] Stopped");
  },

  async _tick() {
    if (!isMarketOpen()) return;
    _log("INFO", `Tick at ${new Date().toISOString()}`);

    const active = _strategies.filter(s => s.status === "ACTIVE");
    for (const strat of active) {
      try { await this._processStrategy(strat); }
      catch (e) { _log("ERROR", `Strategy ${strat.name}: ${e.message}`); }
    }
  },

  // ── Section 1E: _processStrategy ─────────────────────────────────────────
  async _processStrategy(strat) {
    const io = _io;

    // 1. Check daily loss limit
    const pnlToday = getDailyPnl(strat.id);
    if (pnlToday.total < -Math.abs(strat.daily_loss_limit || 10000)) {
      strat.status = "PAUSED";
      _log("WARN", `[${strat.name}] Daily loss limit breached (₹${pnlToday.total.toFixed(0)}). Paused.`);
      if (io) io.emit("daily_loss_limit_reached", {
        strategy_id:   strat.id,
        strategy_name: strat.name,
        pnl:           pnlToday.total,
        limit:         strat.daily_loss_limit,
        timestamp:     new Date().toISOString(),
      });
      return;
    }

    // 2. Look up the registry definition for this strategy's type
    const regEntry = STRATEGY_REGISTRY.find(
      r => r.id === (strat.strategy_type || "multi_momentum")
    );
    const p = regEntry?.parameters || {};

    // 3. Exit checks on open positions for this strategy
    const openForStrat = _openPositions.filter(pos => pos.strategy_id === strat.id);
    for (const pos of openForStrat) {
      try {
        const quote = await mlService.getQuote(pos.symbol);
        const ltp   = quote.ltp;
        pos.current_price = ltp;

        // Update peak for trailing SL tracking
        if (pos.side === "LONG" && ltp > (pos.peak_price || pos.entry_price)) {
          pos.peak_price = ltp;
        }
        pos.pnl = (ltp - pos.entry_price) * pos.qty;

        const targetPrice = pos.entry_price * (1 + (p.target_pct || 5.0) / 100);
        const hardSL      = pos.entry_price * (1 - (p.sl_pct || 2.5) / 100);
        const trailSLPct  = p.trailing_sl_pct || p.sl_pct || 2.5;
        const trailSL     = p.trailing_sl
          ? (pos.peak_price || pos.entry_price) * (1 - trailSLPct / 100)
          : hardSL;
        const effectiveSL = Math.max(hardSL, trailSL);

        const holdMs   = Date.now() - new Date(pos.entry_time).getTime();
        const holdDays = holdMs / (1000 * 60 * 60 * 24);
        const maxHold  = p.max_hold_days || p.hold_days_max || 7;

        let exitReason = null;
        if (ltp >= targetPrice)    exitReason = "TARGET_HIT";
        else if (ltp <= effectiveSL) {
          exitReason = p.trailing_sl ? "TRAILING_SL_HIT" : "STOP_LOSS_HIT";
        } else if (holdDays >= maxHold) {
          exitReason = "MAX_HOLD_DAYS";
        }

        // RSI-based and SuperTrend exits (uses lightweight technical signal)
        if (!exitReason) {
          const sig = await mlService.getTechnicalSignals(pos.symbol).catch(() => null);
          if (sig) {
            const rsiVal = sig.rsi ?? 50;
            if (strat.strategy_type === "multi_momentum" && rsiVal > 70) {
              exitReason = "RSI_OVERBOUGHT";
            } else if (strat.strategy_type === "supertrend_confluence" && rsiVal > 75) {
              exitReason = "RSI_OVERBOUGHT";
            } else if (strat.strategy_type === "mean_reversion" && rsiVal > 55) {
              exitReason = "MEAN_RESTORED";
            }
          }
          // SuperTrend reversal exit for confluence strategy
          if (!exitReason && strat.strategy_type === "supertrend_confluence") {
            const stData = await mlService.getSuperTrend(pos.symbol).catch(() => null);
            if (stData && stData.trend === "SHORT") exitReason = "SUPERTREND_REVERSED";
          }
        }

        if (exitReason) {
          this._closePosition(pos, ltp, exitReason, strat, io);
        }
      } catch (e) {
        _log("WARN", `Exit check failed for ${pos.symbol}: ${e.message}`);
      }
    }

    // 4. Check max concurrent positions and trade count limits
    const openCount     = _openPositions.filter(p => p.strategy_id === strat.id).length;
    const maxConcurrent = strat.max_concurrent || 3;
    if (openCount >= maxConcurrent) return;
    if ((strat.trades_today || 0) >= (strat.max_trades || 10)) return;
    if (!regEntry) return;

    // 5. Scan universe for entry signals
    const openSymbols = new Set(
      _openPositions.filter(pos => pos.strategy_id === strat.id).map(pos => pos.symbol)
    );
    let newPositions = openCount;

    for (const symbol of SCAN_UNIVERSE) {
      if (newPositions >= maxConcurrent) break;
      if (openSymbols.has(symbol)) continue;

      try {
        const [dailyRes, weeklyRes] = await Promise.all([
          ML.get(`/market/ohlcv/${symbol}`, { params: { interval: "1d",  period: "6mo" } }),
          ML.get(`/market/ohlcv/${symbol}`, { params: { interval: "1wk", period: "2y"  } }),
        ]);

        const dailyBars  = dailyRes.data;
        const weeklyBars = weeklyRes.data;
        if (!dailyBars || dailyBars.length < 50) continue;

        const aligned = checkStrategyAlignment(regEntry, dailyBars, weeklyBars, symbol);
        if (aligned.score < 70) continue;

        const ltp = parseFloat(dailyBars[dailyBars.length - 1].close);
        if (!ltp || ltp <= 0) continue;

        // Position sizing: never risk more than 2% of total capital on one trade
        const maxRiskCapital = (strat.capital || 500000) * 0.02;
        const stopDistance   = ltp * ((p.sl_pct || 2.5) / 100);
        const riskQty        = stopDistance > 0 ? Math.floor(maxRiskCapital / stopDistance) : 1;
        const maxQty         = Math.floor(
          (strat.capital_per_trade || (strat.capital || 500000) / 5) / ltp
        );
        const qty = Math.max(1, Math.min(riskQty, maxQty));

        // 5. Place order via brokerClient (paper or live based on mode)
        const order = await brokerClient.placeOrder(symbol, "BUY", qty, "MARKET", 0);

        const pos = {
          id:                uuidv4(),
          order_id:          order.order_id,
          strategy_id:       strat.id,
          strategy_name:     strat.name,
          strategy_type:     strat.strategy_type || "multi_momentum",
          symbol,
          side:              "LONG",
          qty,
          entry_price:       ltp,
          current_price:     ltp,
          peak_price:        ltp,
          pnl:               0,
          status:            "OPEN",
          entry_time:        new Date().toISOString(),
          alignment_score:   aligned.score,
          alignment_reasons: aligned.reasons,
          suggested_sl:      aligned.suggested_sl,
          suggested_target:  aligned.suggested_target,
        };

        _openPositions.push(pos);
        strat.trades_today = (strat.trades_today || 0) + 1;
        newPositions++;
        openSymbols.add(symbol);

        _log("INFO", `${symbol}: LONG ${qty} @ ₹${ltp.toFixed(2)} — ${strat.name} (score: ${aligned.score})`);

        // 6. Emit Socket.IO event for the new trade
        if (io) io.emit("new_algo_trade", { ...pos });

      } catch (e) {
        _log("WARN", `Entry scan ${symbol}: ${e.message}`);
      }
    }
  },

  _closePosition(pos, exitPrice, exitReason, strat, io) {
    const idx = _openPositions.findIndex(p => p.id === pos.id);
    if (idx === -1) return;

    const pnl    = (exitPrice - pos.entry_price) * pos.qty;
    const pnlPct = pos.entry_price > 0 ? (exitPrice - pos.entry_price) / pos.entry_price * 100 : 0;
    const holdMs = Date.now() - new Date(pos.entry_time).getTime();
    const holdDays = +(holdMs / (1000 * 60 * 60 * 24)).toFixed(1);

    const closed = {
      ...pos,
      exit_price:  exitPrice,
      exit_time:   new Date().toISOString(),
      exit_reason: exitReason,
      pnl:         +pnl.toFixed(2),
      pnl_pct:     +pnlPct.toFixed(2),
      hold_days:   holdDays,
      status:      "CLOSED",
    };

    _openPositions.splice(idx, 1);
    _closedTrades.push(closed);
    strat.today_pnl = (strat.today_pnl || 0) + pnl;

    const badge  = pnl >= 0 ? "WIN" : "LOSS";
    _log("INFO", `${pos.symbol}: EXIT @ ₹${exitPrice.toFixed(2)} — ${exitReason} — ${badge} ₹${pnl.toFixed(0)}`);

    if (io) {
      // 6. Emit trade closed event
      io.emit("algo_trade_closed", { ...closed, badge });
      // Emit position_update alert (Section 3)
      io.emit("position_update", {
        symbol:        pos.symbol,
        strategy_name: strat.name,
        action:        "EXIT",
        reason:        exitReason,
        entry_price:   pos.entry_price,
        exit_price:    exitPrice,
        pnl:           +pnl.toFixed(2),
        pnl_pct:       +pnlPct.toFixed(2),
        hold_days:     holdDays,
        badge,
        timestamp:     new Date().toISOString(),
      });
    }

    // Place exit order via brokerClient (fire-and-forget; paper mode returns instantly)
    brokerClient.placeOrder(pos.symbol, "SELL", pos.qty, "MARKET", 0)
      .catch(e => _log("WARN", `Exit order failed for ${pos.symbol}: ${e.message}`));
  },

  // ── Public accessors (used by algo.js routes) ──────────────────────────────
  getStrategies()          { return _strategies; },
  getOpenPositions()       { return _openPositions; },
  getClosedTrades()        { return _closedTrades; },
  getLogs()                { return _engineLogs; },
  getDailyPnlForStrategy:  getDailyPnl,
  getAlignmentResults()    { return _alignmentResults; },
  getLastScanTime()        { return _lastScanTime; },
  getStrategyRegistry()    { return STRATEGY_REGISTRY; },
  getStrategyById(id)      { return STRATEGY_REGISTRY.find(s => s.id === id); },
  runAlignmentScan:        scanStockAlignment,

  addStrategy(s) { _strategies.push(s); },
  updateStrategy(id, data) {
    const idx = _strategies.findIndex(s => s.id === id);
    if (idx >= 0) Object.assign(_strategies[idx], data);
    return _strategies[idx] ?? null;
  },
  removeStrategy(id) {
    const i = _strategies.findIndex(s => s.id === id);
    if (i >= 0) _strategies.splice(i, 1);
  },
  pauseAll() {
    _strategies.forEach(s => { s.status = "PAUSED"; });
    _log("WARN", "EMERGENCY STOP: All strategies paused");
    if (_io) _io.emit("algo_stopped", { timestamp: new Date().toISOString() });
  },

  placePaperTrade(symbol, side, qty, price) {
    const pos = {
      id:            uuidv4(),
      strategy_id:   "manual",
      strategy_name: "Manual Trade",
      strategy_type: "manual",
      symbol:        symbol.toUpperCase(),
      side:          side.toUpperCase(),
      qty:           Math.max(1, Math.floor(qty)),
      entry_price:   price || 0,
      current_price: price || 0,
      peak_price:    price || 0,
      pnl:           0,
      status:        "OPEN",
      entry_time:    new Date().toISOString(),
    };
    _openPositions.push(pos);
    _log("INFO", `Manual paper trade: ${pos.side} ${pos.qty} ${pos.symbol} @ ₹${pos.entry_price}`);
    if (_io) _io.emit("new_algo_trade", { ...pos });
    return pos;
  },

  exitPosition(posId, manualPrice) {
    const pos   = _openPositions.find(p => p.id === posId);
    if (!pos) return null;
    const strat = _strategies.find(s => s.id === pos.strategy_id) || { today_pnl: 0 };
    const price = manualPrice || pos.current_price || pos.entry_price;
    this._closePosition(pos, price, "MANUAL_EXIT", strat, _io);
    return pos;
  },
};

module.exports = algoEngine;
