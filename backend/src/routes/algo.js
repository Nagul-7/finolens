"use strict";
const express    = require("express");
const db         = require("../config/database");
const mlService  = require("../services/mlService");
const algoEngine = require("../services/algoEngine");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// ─── DB helper ────────────────────────────────────────────────────────────────
async function getStrategiesFromDB() {
  const { rows } = await db.query(
    "SELECT * FROM algo_strategies ORDER BY created_at DESC"
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: NEW ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/algo/strategies
// Returns STRATEGY_REGISTRY merged with user instance data (status, pnl, mode)
router.get("/strategies", async (_req, res) => {
  const registry  = algoEngine.getStrategyRegistry();
  const instances = algoEngine.getStrategies();
  const positions = algoEngine.getOpenPositions();

  // Enrich each registry entry with its user-instance data
  const strategies = registry.map(reg => {
    const inst = instances.find(i => i.strategy_type === reg.id);
    const pnl  = inst ? algoEngine.getDailyPnlForStrategy(inst.id) : null;
    const openCount = positions.filter(p => p.strategy_id === inst?.id).length;

    return {
      // Full registry metadata
      ...reg,
      // User instance overlay
      instance_id:    inst?.id    ?? null,
      status:         inst?.status ?? "PAUSED",
      mode:           inst?.mode   ?? "PAPER",
      capital:        inst?.capital ?? 500000,
      capital_per_trade: inst?.capital_per_trade ?? 100000,
      max_concurrent: inst?.max_concurrent ?? 3,
      max_trades:     inst?.max_trades     ?? 10,
      daily_loss_limit: inst?.daily_loss_limit ?? 10000,
      today_pnl:      pnl?.total      ?? 0,
      realized_pnl:   pnl?.realized   ?? 0,
      unrealized_pnl: pnl?.unrealized ?? 0,
      trades_today:   inst?.trades_today ?? 0,
      open_positions: openCount,
    };
  });

  return res.json({ strategies });
});

// GET /api/algo/alignments
// Returns current scan results (populated by 9:20 AM scan or manual trigger)
router.get("/alignments", (_req, res) => {
  const alignments = algoEngine.getAlignmentResults();
  const last_scan  = algoEngine.getLastScanTime();
  return res.json({
    alignments,
    last_scan,
    total: alignments.length,
  });
});

// POST /api/algo/scan-now
// Triggers an immediate alignment scan (can take up to ~60 s for 50 symbols)
router.post("/scan-now", async (_req, res) => {
  try {
    const alignments = await algoEngine.runAlignmentScan();
    return res.json({
      alignments,
      scanned_at: algoEngine.getLastScanTime(),
      total:      alignments.length,
    });
  } catch (err) {
    return res.status(500).json({ error: "Scan failed.", detail: err.message });
  }
});

// GET /api/algo/strategy/:id/info
// Returns full info for a specific strategy (registry) + alignment count
router.get("/strategy/:id/info", (_req, res) => {
  const { id } = _req.params;
  const reg = algoEngine.getStrategyById(id);
  if (!reg) return res.status(404).json({ error: "Strategy not found in registry" });

  const instances  = algoEngine.getStrategies();
  const inst       = instances.find(i => i.strategy_type === id);
  const positions  = algoEngine.getOpenPositions();
  const alignments = algoEngine.getAlignmentResults().filter(a => a.strategy_id === id);
  const pnl        = inst ? algoEngine.getDailyPnlForStrategy(inst.id) : null;

  return res.json({
    ...reg,
    instance_id:       inst?.id ?? null,
    status:            inst?.status ?? "PAUSED",
    mode:              inst?.mode   ?? "PAPER",
    capital:           inst?.capital ?? 500000,
    today_pnl:         pnl?.total   ?? 0,
    trades_today:      inst?.trades_today ?? 0,
    open_positions:    positions.filter(p => p.strategy_id === inst?.id).length,
    alignment_count:   alignments.length,
    top_alignments:    alignments.slice(0, 5),
  });
});

// POST /api/algo/strategy/:id/activate
// Activates a registry strategy for paper/live trading
router.post("/strategy/:id/activate", (req, res) => {
  const { id }                       = req.params;
  const { mode = "PAPER", capital }  = req.body;

  const reg = algoEngine.getStrategyById(id);
  if (!reg) return res.status(404).json({ error: "Strategy not found in registry" });

  const instances = algoEngine.getStrategies();
  const inst      = instances.find(i => i.strategy_type === id);

  if (inst) {
    // Update existing instance
    const updates = { status: "ACTIVE", mode };
    if (capital) updates.capital = Number(capital);
    algoEngine.updateStrategy(inst.id, updates);
    return res.json({ id: inst.id, strategy_type: id, status: "ACTIVE", mode });
  } else {
    // Create a new instance from the registry template
    const cap = capital ? Number(capital) : 500000;
    const newInst = {
      id:               uuidv4(),
      name:             reg.name,
      status:           "ACTIVE",
      mode,
      strategy_type:    id,
      capital:          cap,
      capital_per_trade: Math.floor(cap / 5),
      max_concurrent:   3,
      max_trades:       10,
      daily_loss_limit: Math.floor(cap * 0.03),
      today_pnl:        0,
      trades_today:     0,
      created_at:       new Date().toISOString(),
    };
    algoEngine.addStrategy(newInst);
    return res.status(201).json(newInst);
  }
});

// POST /api/algo/strategy/:id/deactivate
// Pauses a registry strategy without deleting it
router.post("/strategy/:id/deactivate", (req, res) => {
  const { id } = req.params;
  const instances = algoEngine.getStrategies();
  const inst      = instances.find(i => i.strategy_type === id);

  if (!inst) return res.status(404).json({ error: "No active instance for this strategy" });

  algoEngine.updateStrategy(inst.id, { status: "PAUSED" });
  return res.json({ id: inst.id, strategy_type: id, status: "PAUSED" });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING ENDPOINTS — kept for backward compat, extended where needed
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/algo/strategies  (create a custom user strategy)
router.post("/strategies", async (req, res) => {
  const {
    name, mode, universe, timeframe, capital,
    strategy_type, entry_rules, exit_rules,
    capital_per_trade, max_concurrent, daily_loss_limit,
    target_pct, sl_pct, trailing_sl, max_trades,
  } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const cap = capital || 100000;
  const newStrat = {
    id:               uuidv4(),
    name,
    status:           "PAUSED",
    mode:             mode              || "PAPER",
    strategy_type:    strategy_type     || "multi_momentum",
    universe:         universe          || "NIFTY50",
    timeframe:        timeframe         || "1d",
    capital:          cap,
    capital_per_trade: capital_per_trade || Math.floor(cap / 5),
    max_concurrent:   max_concurrent    || 3,
    max_trades:       max_trades        || 10,
    target_pct:       target_pct        || 5.0,
    sl_pct:           sl_pct            || 2.5,
    trailing_sl:      trailing_sl       ?? true,
    daily_loss_limit: daily_loss_limit  || Math.floor(cap * 0.03),
    entry_rules:      entry_rules       || [],
    exit_rules:       exit_rules        || {},
    today_pnl:        0,
    trades_today:     0,
    created_at:       new Date().toISOString(),
  };

  try {
    await db.query(
      `INSERT INTO algo_strategies
         (id, name, status, mode, universe, timeframe, capital)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [newStrat.id, newStrat.name, newStrat.status, newStrat.mode,
       newStrat.universe, newStrat.timeframe, newStrat.capital]
    );
  } catch { /* DB unavailable — engine-only */ }

  algoEngine.addStrategy(newStrat);
  return res.status(201).json(newStrat);
});

// PUT /api/algo/strategies/:id
router.put("/strategies/:id", async (req, res) => {
  const { id }    = req.params;
  const updates   = req.body;

  try {
    const allowed   = ["name", "mode", "universe", "timeframe", "capital", "status"];
    const keys      = Object.keys(updates).filter(k => allowed.includes(k));
    if (keys.length) {
      const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      await db.query(
        `UPDATE algo_strategies SET ${setClause} WHERE id = $1`,
        [id, ...keys.map(k => updates[k])]
      );
    }
  } catch { /* fall through */ }

  algoEngine.updateStrategy(id, updates);
  return res.json({ id, ...updates });
});

// DELETE /api/algo/strategies/:id
router.delete("/strategies/:id", async (req, res) => {
  const { id } = req.params;
  try { await db.query("DELETE FROM algo_strategies WHERE id = $1", [id]); } catch {}
  algoEngine.removeStrategy(id);
  return res.json({ deleted: id });
});

// POST /api/algo/strategies/:id/toggle
router.post("/strategies/:id/toggle", async (req, res) => {
  const { id } = req.params;
  let strat = algoEngine.getStrategies().find(s => s.id === id);

  if (!strat) {
    try {
      const { rows } = await db.query("SELECT * FROM algo_strategies WHERE id = $1", [id]);
      strat = rows[0];
    } catch {}
  }
  if (!strat) return res.status(404).json({ error: "Strategy not found" });

  const newStatus = strat.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    await db.query("UPDATE algo_strategies SET status = $1 WHERE id = $2", [newStatus, id]);
  } catch {}
  algoEngine.updateStrategy(id, { status: newStatus });
  return res.json({ id, status: newStatus });
});

// GET /api/algo/pnl/today  — enriched with win_rate and by_strategy breakdown
router.get("/pnl/today", (_req, res) => {
  const strategies = algoEngine.getStrategies();
  const closed     = algoEngine.getClosedTrades();
  const positions  = algoEngine.getOpenPositions();

  const today = new Date()
    .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    .split(",")[0];

  const todaysClosed = closed.filter(t => {
    if (!t.exit_time) return false;
    return new Date(t.exit_time)
      .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      .split(",")[0] === today;
  });

  let totalRealized   = 0;
  let totalUnrealized = 0;
  const by_strategy   = {};

  for (const strat of strategies) {
    const pnl = algoEngine.getDailyPnlForStrategy(strat.id);
    totalRealized   += pnl.realized;
    totalUnrealized += pnl.unrealized;

    const stratTrades = todaysClosed.filter(t => t.strategy_id === strat.id);
    by_strategy[strat.id] = {
      strategy_name: strat.name,
      strategy_type: strat.strategy_type || "unknown",
      pnl:           +(pnl.total).toFixed(2),
      trades:        stratTrades.length,
      wins:          stratTrades.filter(t => t.pnl >= 0).length,
    };
  }

  const wins       = todaysClosed.filter(t => t.pnl >= 0).length;
  const losses     = todaysClosed.filter(t => t.pnl < 0).length;
  const win_rate   = todaysClosed.length > 0
    ? +((wins / todaysClosed.length) * 100).toFixed(1)
    : 0;

  // Best performing strategy today
  const bestEntry = Object.values(by_strategy)
    .sort((a, b) => b.pnl - a.pnl)[0];

  return res.json({
    total_pnl:        +(totalRealized + totalUnrealized).toFixed(2),
    realized_pnl:     +totalRealized.toFixed(2),
    unrealized_pnl:   +totalUnrealized.toFixed(2),
    trades_today:     todaysClosed.length,
    open_positions:   positions.length,
    winning_trades:   wins,
    losing_trades:    losses,
    win_rate_today:   win_rate,
    best_strategy:    bestEntry?.strategy_name ?? null,
    by_strategy,
    open_positions_list: positions,
    trade_history:    algoEngine.getTradeHistory().slice(-20),
    timestamp:        new Date().toISOString(),
  });
});

// GET /api/algo/performance  — per-strategy performance breakdown
router.get("/performance", (req, res) => {
  const days     = Math.max(1, parseInt(req.query.days) || 30);
  const registry = algoEngine.getStrategyRegistry();

  const strategies = registry.map(s => ({
    ...algoEngine.getStrategyPerformance(s.id, days),
    strategy_name: s.name,
    status:        (algoEngine.getStrategies().find(i => i.strategy_type === s.id) || {}).status || "PAUSED",
    risk_profile:  s.risk_profile,
  }));

  const overall = algoEngine.getStrategyPerformance(null, days);

  return res.json({ strategies, overall, period_days: days });
});

// GET /api/algo/performance/summary  — 30-day summary across all strategies
router.get("/performance/summary", (_req, res) => {
  const closed = algoEngine.getClosedTrades();
  if (!closed.length) {
    return res.json({
      total_return_pct: 0, win_rate: 0, total_trades: 0,
      avg_hold_days: 0, best_trade: null, worst_trade: null,
      by_strategy: [], by_stock: [],
    });
  }

  // 30-day window
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = closed.filter(t => t.exit_time && new Date(t.exit_time).getTime() > cutoff);

  const total_trades = recent.length;
  const wins         = recent.filter(t => t.pnl >= 0).length;
  const win_rate     = total_trades > 0 ? +((wins / total_trades) * 100).toFixed(1) : 0;

  const totalCapital = algoEngine.getStrategies()
    .reduce((sum, s) => sum + (s.capital || 0), 0) || 500000;
  const totalPnl = recent.reduce((s, t) => s + (t.pnl || 0), 0);
  const total_return_pct = +((totalPnl / totalCapital) * 100).toFixed(2);

  const holdDaysArr = recent
    .filter(t => t.hold_days != null)
    .map(t => t.hold_days);
  const avg_hold_days = holdDaysArr.length > 0
    ? +(holdDaysArr.reduce((a, b) => a + b, 0) / holdDaysArr.length).toFixed(1)
    : 0;

  const sorted   = [...recent].sort((a, b) => (b.pnl || 0) - (a.pnl || 0));
  const best     = sorted[0];
  const worst    = sorted[sorted.length - 1];

  // Group by strategy
  const byStratMap = {};
  for (const t of recent) {
    const key = t.strategy_name || "Unknown";
    if (!byStratMap[key]) byStratMap[key] = { strategy_name: key, trades: 0, pnl: 0, wins: 0 };
    byStratMap[key].trades++;
    byStratMap[key].pnl += t.pnl || 0;
    if ((t.pnl || 0) >= 0) byStratMap[key].wins++;
  }
  const by_strategy = Object.values(byStratMap).map(s => ({
    ...s,
    pnl:      +s.pnl.toFixed(2),
    win_rate: s.trades > 0 ? +((s.wins / s.trades) * 100).toFixed(1) : 0,
  })).sort((a, b) => b.pnl - a.pnl);

  // Group by stock
  const byStockMap = {};
  for (const t of recent) {
    const sym = t.symbol;
    if (!byStockMap[sym]) byStockMap[sym] = { symbol: sym, trades: 0, pnl: 0, wins: 0 };
    byStockMap[sym].trades++;
    byStockMap[sym].pnl += t.pnl || 0;
    if ((t.pnl || 0) >= 0) byStockMap[sym].wins++;
  }
  const by_stock = Object.values(byStockMap).map(s => ({
    ...s,
    pnl: +s.pnl.toFixed(2),
    win_rate: s.trades > 0 ? +((s.wins / s.trades) * 100).toFixed(1) : 0,
  })).sort((a, b) => b.pnl - a.pnl).slice(0, 10);

  return res.json({
    total_return_pct,
    win_rate,
    total_trades,
    avg_hold_days,
    best_trade:  best  ? { symbol: best.symbol,  pnl: +best.pnl.toFixed(2),  strategy: best.strategy_name }  : null,
    worst_trade: worst ? { symbol: worst.symbol, pnl: +worst.pnl.toFixed(2), strategy: worst.strategy_name } : null,
    by_strategy,
    by_stock,
  });
});

// GET /api/algo/positions  — open positions with live LTP
router.get("/positions", async (_req, res) => {
  const positions = algoEngine.getOpenPositions();

  if (positions.length === 0) {
    try {
      const { rows } = await db.query(
        "SELECT * FROM algo_trades WHERE status = 'OPEN' ORDER BY created_at DESC"
      );
      if (rows.length) return res.json(rows);
    } catch {}
    return res.json([]);
  }

  const enriched = await Promise.all(
    positions.map(async pos => {
      try {
        const quote = await mlService.getQuote(pos.symbol);
        const ltp   = quote.ltp ?? pos.current_price ?? pos.entry_price;
        const holdDays = +((Date.now() - new Date(pos.entry_time).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1);
        return {
          ...pos,
          current_price:  ltp,
          unrealized_pnl: +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl:            +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl_pct:        pos.entry_price > 0
            ? +(((ltp - pos.entry_price) / pos.entry_price) * 100).toFixed(2)
            : 0,
          hold_days: holdDays,
        };
      } catch {
        const ltp = pos.current_price ?? pos.entry_price;
        return {
          ...pos,
          unrealized_pnl: +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl:            +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl_pct:        0,
          hold_days:      0,
        };
      }
    })
  );

  return res.json(enriched);
});

// POST /api/algo/positions/:id/exit
router.post("/positions/:id/exit", async (req, res) => {
  const { id } = req.params;
  const pos = algoEngine.getOpenPositions().find(p => p.id === id);
  if (!pos) return res.status(404).json({ error: "Position not found or already closed" });

  let exitPrice = pos.current_price ?? pos.entry_price;
  try {
    const quote = await mlService.getQuote(pos.symbol);
    exitPrice   = quote.ltp ?? exitPrice;
  } catch {}

  const closed = algoEngine.exitPosition(id, exitPrice);
  if (!closed) return res.status(404).json({ error: "Could not close position" });

  const io = req.app.get("io");
  if (io) {
    io.emit("algo_trade_closed", {
      ...closed,
      exit_price:  exitPrice,
      exit_reason: "MANUAL_EXIT",
      badge:       ((exitPrice - closed.entry_price) * closed.qty) >= 0 ? "WIN" : "LOSS",
    });
  }

  return res.json({
    ...closed,
    exit_price:  exitPrice,
    exit_reason: "MANUAL_EXIT",
    pnl:         +((exitPrice - closed.entry_price) * closed.qty).toFixed(2),
  });
});

// GET /api/algo/trades/history
router.get("/trades/history", (_req, res) => {
  const engine_trades = algoEngine.getClosedTrades();
  const strategies    = algoEngine.getStrategies();
  const stratMap      = Object.fromEntries(strategies.map(s => [s.id, s.name]));

  if (engine_trades.length > 0) {
    return res.json(
      engine_trades.slice(0, 50).map(t => ({
        ...t,
        strategy_name: stratMap[t.strategy_id] || t.strategy_name || "Unknown",
        badge:         (t.pnl >= 0) ? "WIN" : "LOSS",
      }))
    );
  }

  try {
    db.query(`
      SELECT t.*, s.name AS strategy_name
      FROM   algo_trades t
      LEFT   JOIN algo_strategies s ON s.id = t.strategy_id
      WHERE  t.status = 'CLOSED'
      ORDER  BY t.exit_time DESC LIMIT 50
    `).then(({ rows }) => {
      if (rows.length) return res.json(rows.map(r => ({ ...r, badge: r.pnl >= 0 ? "WIN" : "LOSS" })));
      return res.json([]);
    }).catch(() => res.json([]));
  } catch {
    return res.json([]);
  }
});

// GET /api/algo/trades  (legacy)
router.get("/trades", (_req, res) => {
  const closed = algoEngine.getClosedTrades();
  const open   = algoEngine.getOpenPositions();

  const all = [
    ...closed.slice(0, 25).map(t => ({ ...t, badge: (t.pnl >= 0) ? "WIN" : "LOSS", action: "SELL" })),
    ...open.slice(0, 25).map(p => ({ ...p, action: "BUY" })),
  ].sort((a, b) =>
    new Date(b.exit_time || b.entry_time) - new Date(a.exit_time || a.entry_time)
  );
  return res.json(all);
});

// POST /api/algo/stop-all
router.post("/stop-all", async (req, res) => {
  try { await db.query("UPDATE algo_strategies SET status = 'PAUSED'"); } catch {}
  algoEngine.pauseAll();
  const io = req.app.get("io");
  if (io) io.emit("algo_stopped", { timestamp: new Date().toISOString() });
  return res.json({ stopped: true, timestamp: new Date().toISOString() });
});

// POST /api/algo/paper-trade
router.post("/paper-trade", async (req, res) => {
  const { symbol, side, qty, order_type, price, mode = "paper" } = req.body;
  if (!symbol || !side || !qty) {
    return res.status(400).json({ error: "symbol, side, qty are required" });
  }
  try {
    if (mode === "live") {
      const brokerClient = require("../services/brokerClient");
      if (brokerClient.activeBroker === "yfinance") {
        return res.status(400).json({
          error: "Live trading requires a real broker. Set BROKER=zerodha or BROKER=angel in .env.",
        });
      }
      const order = await brokerClient.placeOrder(symbol, side, parseInt(qty), order_type || "MARKET", price || 0);
      return res.status(201).json({ ...order, mode: "live", strategy_id: "manual" });
    }

    let tradePrice = price ? parseFloat(price) : 0;
    if (!tradePrice || order_type === "MARKET") {
      try {
        const quote = await mlService.getQuote(symbol.toUpperCase());
        tradePrice  = quote.ltp ?? quote.price ?? 0;
      } catch {}
    }
    const pos = algoEngine.placePaperTrade(symbol, side, parseInt(qty), tradePrice);
    return res.status(201).json({ ...pos, mode: "paper" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/algo/logs
router.get("/logs", (_req, res) => res.json(algoEngine.getLogs()));

module.exports = router;
