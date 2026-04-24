"use strict";
/**
 * AlgoEngine — paper trading execution loop.
 *
 * Runs every 5 minutes during NSE market hours (9:15–15:30 IST, weekdays).
 * Evaluates entry/exit conditions for every ACTIVE strategy against live
 * technical signals, places and closes paper trades, and emits Socket.IO
 * events so the frontend updates in real time.
 */

const { v4: uuidv4 } = require("uuid");
const mlService       = require("./mlService");

// ─── Scan universe (top Nifty50 by liquidity) ────────────────────────────────
const NIFTY50_SCAN = [
  "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY",
  "HINDUNILVR", "ITC", "KOTAKBANK", "SBIN", "AXISBANK",
  "BAJFINANCE", "BHARTIARTL", "LT", "HCLTECH", "WIPRO",
  "TATAMOTORS", "MARUTI", "SUNPHARMA", "TITAN", "NTPC",
];

// ─── In-memory state (DB-less fallback) ──────────────────────────────────────
// Shared with algo.js route via module-level exports
const _strategies  = [
  {
    id: "1", name: "Momentum Breakout v2", status: "ACTIVE", mode: "PAPER",
    universe: "NIFTY50", timeframe: "15m", capital: 500000,
    capital_per_trade: 50000, max_concurrent: 3, max_trades: 20,
    target_pct: 2.0, sl_pct: 1.0, trailing_sl: true, daily_loss_limit: 10000,
    today_pnl: 0, trades_today: 0, created_at: new Date().toISOString(),
    entry_rules: [
      { indicator: "technical_score", operator: "gt", value: 58 },
      { indicator: "volume_ratio",    operator: "gt", value: 1.2 },
    ],
  },
  {
    id: "2", name: "Mean Reversion RSI", status: "PAUSED", mode: "PAPER",
    universe: "NIFTY50", timeframe: "1h", capital: 250000,
    capital_per_trade: 25000, max_concurrent: 2, max_trades: 10,
    target_pct: 1.5, sl_pct: 0.8, trailing_sl: false, daily_loss_limit: 5000,
    today_pnl: 0, trades_today: 0, created_at: new Date().toISOString(),
    entry_rules: [
      { indicator: "rsi", operator: "lt", value: 40 },
      { indicator: "macd_hist", operator: "gt", value: 0 },
    ],
  },
];

const _openPositions  = [];   // { id, strategy_id, symbol, side, qty, entry_price, current_price, pnl, status, entry_time, peak_price }
const _closedTrades   = [];   // { ...position, exit_price, exit_time, exit_reason }
const _engineLogs     = [];

// ─── Market hours (IST) ───────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day  = ist.getDay();          // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930;  // 9:15 → 15:30
}

// ─── Entry rule evaluator ─────────────────────────────────────────────────────
function evaluateRules(rules, signal, supertrend) {
  for (const rule of rules) {
    const val = getIndicatorValue(rule.indicator, signal, supertrend);
    if (val === null) continue;          // missing data → skip rule
    switch (rule.operator) {
      case "gt": if (!(val >  rule.value)) return false; break;
      case "lt": if (!(val <  rule.value)) return false; break;
      case "gte": if (!(val >= rule.value)) return false; break;
      case "lte": if (!(val <= rule.value)) return false; break;
      case "eq":  if (!(val === rule.value)) return false; break;
      default:    break;
    }
  }
  return true;
}

function getIndicatorValue(indicator, signal, supertrend) {
  const map = {
    rsi:             signal?.rsi,
    macd:            signal?.macd,
    macd_hist:       signal?.macd_hist,
    macd_signal:     signal?.macd_signal,
    technical_score: signal?.technical_score,
    volume_ratio:    signal?.volume_ratio,
    bb_position:     signal?.bb_position,
    supertrend:      supertrend?.trend === "LONG" ? 1 : 0,
  };
  return map[indicator] ?? null;
}

// ─── Universe resolver ────────────────────────────────────────────────────────
function getUniverse(stratUniverse) {
  if (Array.isArray(stratUniverse)) return stratUniverse.map(s => s.toUpperCase());
  return NIFTY50_SCAN;
}

// ─── Daily P&L helpers ────────────────────────────────────────────────────────
function getTodayIST() {
  return new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }).split(",")[0];
}

function getDailyPnl(strategyId) {
  const today = getTodayIST();
  const realized = _closedTrades
    .filter(t => t.strategy_id === strategyId && new Date(t.exit_time).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }).startsWith(today))
    .reduce((sum, t) => sum + (t.pnl || 0), 0);
  const unrealized = _openPositions
    .filter(p => p.strategy_id === strategyId)
    .reduce((sum, p) => sum + (p.pnl || 0), 0);
  return { realized, unrealized, total: realized + unrealized };
}

// ─── Core engine ─────────────────────────────────────────────────────────────
const algoEngine = {
  _interval: null,
  _io:       null,

  start(io) {
    this._io = io || null;
    if (this._interval) return;            // already running
    this._interval = setInterval(() => this._tick(), 5 * 60 * 1000);
    _log("INFO", "AlgoEngine started — 5-minute execution loop active");
    console.log("[AlgoEngine] Started");
  },

  stop() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    _log("INFO", "AlgoEngine stopped");
    console.log("[AlgoEngine] Stopped");
  },

  async _tick() {
    if (!isMarketOpen()) return;
    _log("INFO", `Tick at ${new Date().toISOString()}`);

    const activeStrats = _strategies.filter(s => s.status === "ACTIVE");
    for (const strat of activeStrats) {
      try { await this._processStrategy(strat); }
      catch (e) { _log("ERROR", `Strategy ${strat.name}: ${e.message}`); }
    }
  },

  async _processStrategy(strat) {
    const io  = this._io;
    const universe = getUniverse(strat.universe);

    // ── 1. Check/update exit conditions on open positions ──────────────────
    const openForStrat = _openPositions.filter(p => p.strategy_id === strat.id);
    for (const pos of openForStrat) {
      try {
        const quote = await mlService.getQuote(pos.symbol);
        const ltp   = quote.ltp;
        pos.current_price = ltp;

        // Trailing SL: update peak
        if (pos.side === "LONG" && ltp > (pos.peak_price || pos.entry_price)) {
          pos.peak_price = ltp;
        }

        const targetPrice  = pos.entry_price * (1 + strat.target_pct / 100);
        const hardSL       = pos.entry_price * (1 - strat.sl_pct / 100);
        const trailSL      = strat.trailing_sl
          ? (pos.peak_price || pos.entry_price) * (1 - strat.sl_pct / 100)
          : hardSL;
        const effectiveSL  = Math.max(hardSL, trailSL);

        pos.pnl = (ltp - pos.entry_price) * pos.qty;

        let exitReason = null;
        if (ltp >= targetPrice) exitReason = "TARGET_HIT";
        if (ltp <= effectiveSL) exitReason = strat.trailing_sl ? "TRAILING_SL_HIT" : "STOP_LOSS_HIT";

        // Max hold: intraday — exit at 15:15 IST
        if (!exitReason) {
          const istNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
          const mins   = istNow.getHours() * 60 + istNow.getMinutes();
          if (mins >= 915) exitReason = "MAX_HOLD_INTRADAY";
        }

        if (exitReason) {
          this._closePosition(pos, ltp, exitReason, strat, io);
        }
      } catch (e) {
        _log("WARN", `Exit check failed for ${pos.symbol}: ${e.message}`);
      }
    }

    // ── 2. Check daily loss limit ──────────────────────────────────────────
    const pnlToday = getDailyPnl(strat.id);
    if (pnlToday.total < -Math.abs(strat.daily_loss_limit || 10000)) {
      strat.status = "PAUSED";
      _log("WARN", `[${strat.name}] Daily loss limit breached (₹${pnlToday.total.toFixed(0)}). Strategy paused.`);
      if (io) io.emit("daily_loss_limit_reached", {
        strategy_id:   strat.id,
        strategy_name: strat.name,
        pnl:           pnlToday.total,
        limit:         strat.daily_loss_limit,
        timestamp:     new Date().toISOString(),
      });
      return;
    }

    // ── 3. Scan for entries ────────────────────────────────────────────────
    const openCount = _openPositions.filter(p => p.strategy_id === strat.id).length;
    const maxConcurrent = strat.max_concurrent || 3;
    if (openCount >= maxConcurrent) return;

    const openSymbols = new Set(_openPositions.filter(p => p.strategy_id === strat.id).map(p => p.symbol));
    let newPositions = openCount;

    for (const symbol of universe) {
      if (newPositions >= maxConcurrent) break;
      if (openSymbols.has(symbol)) continue;

      try {
        const [signal, supertrend] = await Promise.all([
          mlService.getTechnicalSignals(symbol).catch(() => null),
          mlService.getSuperTrend(symbol).catch(() => null),
        ]);
        if (!signal) continue;

        const rules = strat.entry_rules || [
          { indicator: "technical_score", operator: "gt", value: 58 },
        ];
        const entryOk = evaluateRules(rules, signal, supertrend);

        // Require SuperTrend LONG if available; skip rule if endpoint unavailable
        const stOk = !supertrend || supertrend.trend === "LONG";

        if (entryOk && stOk) {
          const ltp = signal.current_price;
          if (!ltp || ltp <= 0) continue;
          this._placeOrder(strat, symbol, ltp, signal, supertrend, io);
          newPositions++;
          openSymbols.add(symbol);
          strat.trades_today = (strat.trades_today || 0) + 1;
        }
      } catch (e) {
        _log("WARN", `Entry scan ${symbol}: ${e.message}`);
      }
    }
  },

  _placeOrder(strat, symbol, ltp, signal, supertrend, io) {
    const capitalPerTrade = strat.capital_per_trade || (strat.capital || 100000) / 10;
    const qty = Math.max(1, Math.floor(capitalPerTrade / ltp));

    const pos = {
      id:            uuidv4(),
      strategy_id:   strat.id,
      strategy_name: strat.name,
      symbol,
      side:          "LONG",
      qty,
      entry_price:   ltp,
      current_price: ltp,
      peak_price:    ltp,
      pnl:           0,
      status:        "OPEN",
      entry_time:    new Date().toISOString(),
    };

    _openPositions.push(pos);
    const logMsg = `${symbol}: LONG ${qty} @ ₹${ltp.toFixed(2)} — ${strat.name}`;
    _log("INFO", logMsg);
    if (io) io.emit("new_algo_trade", { ...pos });
    _log("INFO", `Placed paper LONG: ${logMsg}`);
  },

  _closePosition(pos, exitPrice, exitReason, strat, io) {
    const idx = _openPositions.findIndex(p => p.id === pos.id);
    if (idx === -1) return;

    const pnl = (exitPrice - pos.entry_price) * pos.qty;
    const closed = {
      ...pos,
      exit_price:  exitPrice,
      exit_time:   new Date().toISOString(),
      exit_reason: exitReason,
      pnl,
      status:      "CLOSED",
    };

    _openPositions.splice(idx, 1);
    _closedTrades.push(closed);
    strat.today_pnl = (strat.today_pnl || 0) + pnl;

    const badge  = pnl >= 0 ? "WIN" : "LOSS";
    const logMsg = `${pos.symbol}: EXIT @ ₹${exitPrice.toFixed(2)} — ${exitReason} — ${badge} ₹${pnl.toFixed(0)}`;
    _log("INFO", logMsg);
    if (io) io.emit("algo_trade_closed", { ...closed });
  },

  // ─── Public accessors (used by algo.js routes) ──────────────────────────
  getStrategies()          { return _strategies; },
  getOpenPositions()       { return _openPositions; },
  getClosedTrades()        { return _closedTrades; },
  getLogs()                { return _engineLogs; },
  getDailyPnlForStrategy:  getDailyPnl,

  addStrategy(s)           { _strategies.push(s); },
  updateStrategy(id, data) {
    const idx = _strategies.findIndex(s => s.id === id);
    if (idx >= 0) Object.assign(_strategies[idx], data);
    return _strategies[idx] ?? null;
  },
  removeStrategy(id)       { const i = _strategies.findIndex(s => s.id === id); if (i >= 0) _strategies.splice(i, 1); },
  pauseAll() {
    _strategies.forEach(s => { s.status = "PAUSED"; });
    _log("WARN", "EMERGENCY STOP: All strategies paused");
    if (this._io) this._io.emit("algo_stopped", { timestamp: new Date().toISOString() });
  },

  exitPosition(posId, manualPrice) {
    const pos = _openPositions.find(p => p.id === posId);
    if (!pos) return null;
    const strat = _strategies.find(s => s.id === pos.strategy_id) || {};
    const price = manualPrice || pos.current_price || pos.entry_price;
    this._closePosition(pos, price, "MANUAL_EXIT", strat, this._io);
    return pos;
  },
};

function _log(level, msg) {
  _engineLogs.unshift({ ts: new Date().toISOString(), level, msg });
  if (_engineLogs.length > 200) _engineLogs.length = 200;
}

module.exports = algoEngine;
