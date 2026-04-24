require("dotenv").config();

const { httpServer, app } = require("./app");
const { pool } = require("./config/database");
const { getRedis } = require("./config/redis");
const algoEngine = require("./services/algoEngine");

const PORT = process.env.PORT || 5000;

async function start() {
  // Verify DB connectivity (non-fatal — app still starts without DB)
  try {
    await pool.query("SELECT 1");
    console.log("[DB] PostgreSQL connected");
  } catch (err) {
    console.warn("[DB] PostgreSQL not reachable:", err.message);
  }

  // Kick Redis connection
  getRedis().connect().catch(() => {});

  httpServer.listen(PORT, () => {
    console.log(`[server] FinoLens backend running on http://localhost:${PORT}`);
    console.log(`[server] ML service → ${process.env.ML_SERVICE_URL || "http://localhost:8000"}`);

    // Start the algo engine with Socket.IO instance
    const io = app.get("io");
    algoEngine.start(io);
    console.log("[AlgoEngine] Paper trading engine started");
  });

  // Graceful shutdown
  function shutdown(signal) {
    console.log(`[server] ${signal} received — shutting down…`);
    algoEngine.stop();
    httpServer.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

start();
