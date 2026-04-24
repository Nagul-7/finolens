"use strict";
const express   = require("express");
const db        = require("../config/database");
const mlService = require("../services/mlService");
const algoEngine = require("../services/algoEngine");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function getStrategiesFromDB() {
  const { rows } = await db.query(
    "SELECT * FROM algo_strategies ORDER BY created_at DESC"
  );
  return rows;
}

// ─── GET /api/algo/strategies ────────────────────────────────────────────────
router.get("/strategies", async (req, res) => {
  try {
    const rows = await getStrategiesFromDB();
    if (rows.length) return res.json(rows);
  } catch { /* fall through to engine */ }
  return res.json(algoEngine.getStrategies());
});

// ─── POST /api/algo/strategies ───────────────────────────────────────────────
router.post("/strategies", async (req, res) => {
  const {
    name, mode, universe, timeframe, capital,
    entry_rules, exit_rules,
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
    universe:         universe          || "NIFTY50",
    timeframe:        timeframe         || "15m",
    capital:          cap,
    capital_per_trade: capital_per_trade || Math.floor(cap / 10),
    max_concurrent:   max_concurrent    || 3,
    max_trades:       max_trades        || 20,
    target_pct:       target_pct        || 2.0,
    sl_pct:           sl_pct            || 1.0,
    trailing_sl:      trailing_sl       ?? true,
    daily_loss_limit: daily_loss_limit  || 5000,
    entry_rules:      entry_rules       || [{ indicator: "technical_score", operator: "gt", value: 58 }],
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

// ─── PUT /api/algo/strategies/:id ────────────────────────────────────────────
router.put("/strategies/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const allowed = ["name", "mode", "universe", "timeframe", "capital"];
    const keys    = Object.keys(updates).filter(k => allowed.includes(k));
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

// ─── DELETE /api/algo/strategies/:id ─────────────────────────────────────────
router.delete("/strategies/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM algo_strategies WHERE id = $1", [id]);
  } catch { /* fall through */ }
  algoEngine.removeStrategy(id);
  return res.json({ deleted: id });
});

// ─── POST /api/algo/strategies/:id/toggle ────────────────────────────────────
router.post("/strategies/:id/toggle", async (req, res) => {
  const { id } = req.params;
  let strat = algoEngine.getStrategies().find(s => s.id === id);

  if (!strat) {
    try {
      const { rows } = await db.query("SELECT * FROM algo_strategies WHERE id = $1", [id]);
      strat = rows[0];
    } catch { /* fall through */ }
  }
  if (!strat) return res.status(404).json({ error: "Strategy not found" });

  const newStatus = strat.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  try {
    await db.query("UPDATE algo_strategies SET status = $1 WHERE id = $2", [newStatus, id]);
  } catch { /* fall through */ }
  algoEngine.updateStrategy(id, { status: newStatus });
  return res.json({ id, status: newStatus });
});

// ─── GET /api/algo/pnl/today ─────────────────────────────────────────────────
// Sum of realized closed P&L today + unrealized from open positions
router.get("/pnl/today", async (req, res) => {
  const strategies = algoEngine.getStrategies();
  let totalRealized   = 0;
  let totalUnrealized = 0;

  for (const strat of strategies) {
    const pnl = algoEngine.getDailyPnlForStrategy(strat.id);
    totalRealized   += pnl.realized;
    totalUnrealized += pnl.unrealized;
  }

  const today = new Date()
    .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    .split(",")[0];

  const tradesToday = algoEngine.getClosedTrades().filter(t => {
    if (!t.exit_time) return false;
    const td = new Date(t.exit_time)
      .toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      .split(",")[0];
    return td === today;
  }).length;

  return res.json({
    realized_pnl:   +totalRealized.toFixed(2),
    unrealized_pnl: +totalUnrealized.toFixed(2),
    total_pnl:      +(totalRealized + totalUnrealized).toFixed(2),
    trades_today:   tradesToday,
    open_positions: algoEngine.getOpenPositions().length,
    timestamp:      new Date().toISOString(),
  });
});

// ─── GET /api/algo/positions ──────────────────────────────────────────────────
// Returns open positions with current LTP + unrealized P&L fetched live
router.get("/positions", async (req, res) => {
  const positions = algoEngine.getOpenPositions();

  if (positions.length === 0) {
    // Fall back to DB when engine just started
    try {
      const { rows } = await db.query(
        "SELECT * FROM algo_trades WHERE status = 'OPEN' ORDER BY created_at DESC"
      );
      if (rows.length) return res.json(rows);
    } catch { /* nothing */ }
    return res.json([]);
  }

  // Enrich each position with live LTP
  const enriched = await Promise.all(
    positions.map(async pos => {
      try {
        const quote = await mlService.getQuote(pos.symbol);
        const ltp   = quote.ltp ?? pos.current_price ?? pos.entry_price;
        return {
          ...pos,
          current_price:  ltp,
          unrealized_pnl: +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl:            +((ltp - pos.entry_price) * pos.qty).toFixed(2),
        };
      } catch {
        const ltp = pos.current_price ?? pos.entry_price;
        return {
          ...pos,
          unrealized_pnl: +((ltp - pos.entry_price) * pos.qty).toFixed(2),
          pnl:            +((ltp - pos.entry_price) * pos.qty).toFixed(2),
        };
      }
    })
  );

  return res.json(enriched);
});

// ─── POST /api/algo/positions/:id/exit ───────────────────────────────────────
// Manually close a paper position at current market price
router.post("/positions/:id/exit", async (req, res) => {
  const { id } = req.params;
  const pos = algoEngine.getOpenPositions().find(p => p.id === id);
  if (!pos) return res.status(404).json({ error: "Position not found or already closed" });

  let exitPrice = pos.current_price ?? pos.entry_price;
  try {
    const quote = await mlService.getQuote(pos.symbol);
    exitPrice = quote.ltp ?? exitPrice;
  } catch { /* use last known */ }

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

// ─── GET /api/algo/trades/history ────────────────────────────────────────────
// Last 50 closed trades across all strategies (with strategy_name)
router.get("/trades/history", async (req, res) => {
  const engine_trades = algoEngine.getClosedTrades();

  if (engine_trades.length > 0) {
    const strategies = algoEngine.getStrategies();
    const stratMap  = Object.fromEntries(strategies.map(s => [s.id, s.name]));
    return res.json(
      engine_trades.slice(0, 50).map(t => ({
        ...t,
        strategy_name: stratMap[t.strategy_id] || t.strategy_name || "Unknown",
        badge: (t.pnl >= 0) ? "WIN" : "LOSS",
      }))
    );
  }

  // Try DB with join
  try {
    const { rows } = await db.query(`
      SELECT t.*, s.name AS strategy_name
      FROM   algo_trades t
      LEFT   JOIN algo_strategies s ON s.id = t.strategy_id
      WHERE  t.status = 'CLOSED'
      ORDER  BY t.exit_time DESC
      LIMIT  50
    `);
    if (rows.length) return res.json(rows.map(r => ({ ...r, badge: r.pnl >= 0 ? "WIN" : "LOSS" })));
  } catch { /* fall through */ }

  return res.json([]);
});

// ─── GET /api/algo/trades  (legacy log view) ─────────────────────────────────
router.get("/trades", async (req, res) => {
  const closed = algoEngine.getClosedTrades();
  const open   = algoEngine.getOpenPositions();

  if (closed.length === 0 && open.length === 0) {
    try {
      const { rows } = await db.query(
        "SELECT * FROM algo_trades ORDER BY created_at DESC LIMIT 50"
      );
      if (rows.length) return res.json(rows);
    } catch { /* fall through */ }
  }

  const all = [
    ...closed.slice(0, 25).map(t => ({
      ...t,
      badge:  (t.pnl >= 0) ? "WIN" : "LOSS",
      action: "SELL",
      time:   t.exit_time?.split("T")[1]?.slice(0, 8),
    })),
    ...open.slice(0, 25).map(p => ({
      ...p,
      action: "BUY",
      time:   p.entry_time?.split("T")[1]?.slice(0, 8),
    })),
  ].sort((a, b) =>
    new Date(b.exit_time || b.entry_time) - new Date(a.exit_time || a.entry_time)
  );

  return res.json(all);
});

// ─── POST /api/algo/stop-all ─────────────────────────────────────────────────
router.post("/stop-all", async (req, res) => {
  try {
    await db.query("UPDATE algo_strategies SET status = 'PAUSED'");
  } catch { /* fall through */ }

  algoEngine.pauseAll();

  const io = req.app.get("io");
  if (io) io.emit("algo_stopped", { timestamp: new Date().toISOString() });

  return res.json({ stopped: true, timestamp: new Date().toISOString() });
});

// ─── GET /api/algo/logs ───────────────────────────────────────────────────────
router.get("/logs", (_req, res) => res.json(algoEngine.getLogs()));

module.exports = router;
