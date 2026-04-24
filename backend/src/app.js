require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { createServer } = require("http");
const { Server } = require("socket.io");

const callsRouter     = require("./routes/calls");
const technicalRouter = require("./routes/technical");
const marketRouter    = require("./routes/market");
const optionsRouter   = require("./routes/options");
const screenerRouter  = require("./routes/screener");
const watchlistRouter = require("./routes/watchlist");
const backtestRouter  = require("./routes/backtest");
const algoRouter      = require("./routes/algo");
const dashboardRouter = require("./routes/dashboard");
const { errorHandler, notFound } = require("./middleware/errorHandler");
const { setupLiveAlerts } = require("./socket/liveAlerts");

const app = express();
const httpServer = createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000" },
});

io.on("connection", (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);
  socket.on("subscribe",   (symbol) => socket.join(symbol.toUpperCase()));
  socket.on("unsubscribe", (symbol) => socket.leave(symbol.toUpperCase()));
  socket.on("disconnect",  () => console.log(`[ws] client left: ${socket.id}`));
});

app.set("io", io);

// Watchlist helper for live alerts
async function getWatchlistSymbols() {
  const db = require("./config/database");
  try {
    const { rows } = await db.query("SELECT symbol FROM watchlist ORDER BY created_at ASC");
    return rows.length ? rows.map((r) => r.symbol) : ["RELIANCE", "HDFCBANK", "TCS", "INFY"];
  } catch {
    return ["RELIANCE", "HDFCBANK", "TCS", "INFY"];
  }
}

setupLiveAlerts(io, getWatchlistSymbols);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000" }));
app.use(express.json());
app.use(morgan("dev"));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a moment." },
});
app.use("/api", limiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/dashboard", dashboardRouter);
app.use("/api/market",    marketRouter);
app.use("/api",           callsRouter);        // /api/calls/:symbol, /api/symbols
app.use("/api",           technicalRouter);    // /api/technical/:symbol
app.use("/api/options",   optionsRouter);
app.use("/api/screener",  screenerRouter);
app.use("/api/watchlist", watchlistRouter);
app.use("/api/backtest",  backtestRouter);
app.use("/api/algo",      algoRouter);

app.get("/health", (_req, res) =>
  res.json({ status: "ok", service: "finolens-backend", version: "2.0.0" })
);

app.use(notFound);
app.use(errorHandler);

module.exports = { app, httpServer };
