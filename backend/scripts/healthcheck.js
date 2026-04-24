#!/usr/bin/env node
/**
 * FinoLens Healthcheck
 * Tests: DB, Redis, ML service /health, and a live quote fetch.
 * Exit 0 = all pass | Exit 1 = one or more failures.
 */

"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { Pool }  = require("pg");
const Redis     = require("ioredis");
const axios     = require("axios");

const ML_BASE = process.env.ML_SERVICE_URL || "http://localhost:8000";
const DB_URL  = process.env.DATABASE_URL   || "postgresql://finolens:finolens_secret@localhost:5432/finolens";
const RD_URL  = process.env.REDIS_URL      || "redis://localhost:6379";

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

let failures = 0;

function pass(label, detail = "") {
  console.log(`  ${GREEN}✔ PASS${RESET}  ${BOLD}${label}${RESET}${detail ? `  ${CYAN}${detail}${RESET}` : ""}`);
}
function fail(label, err) {
  console.log(`  ${RED}✖ FAIL${RESET}  ${BOLD}${label}${RESET}  ${RED}${err}${RESET}`);
  failures++;
}

// ── 1. PostgreSQL ─────────────────────────────────────────────────────────────
async function checkDB() {
  const pool = new Pool({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  try {
    const { rows } = await pool.query("SELECT version()");
    const ver = rows[0].version.split(" ").slice(0, 2).join(" ");
    pass("PostgreSQL", ver);
  } catch (e) {
    fail("PostgreSQL", e.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── 2. Redis ─────────────────────────────────────────────────────────────────
async function checkRedis() {
  const client = new Redis(RD_URL, { lazyConnect: true, connectTimeout: 5000, maxRetriesPerRequest: 0 });
  try {
    await client.connect();
    const pong = await client.ping();
    pass("Redis", `PING → ${pong}`);
  } catch (e) {
    fail("Redis", e.message);
  } finally {
    await client.quit().catch(() => {});
  }
}

// ── 3. ML Service /health ─────────────────────────────────────────────────────
async function checkML() {
  try {
    const { data, status } = await axios.get(`${ML_BASE}/health`, { timeout: 10000 });
    if (status === 200 && data.status === "ok") {
      pass("ML Service /health", `v${data.version || "?"}`);
    } else {
      fail("ML Service /health", `status=${status}`);
    }
  } catch (e) {
    fail("ML Service /health", e.message);
  }
}

// ── 4. Live quote ─────────────────────────────────────────────────────────────
async function checkLiveQuote() {
  const symbol = "RELIANCE";
  try {
    const { data } = await axios.get(`${ML_BASE}/market/quote/${symbol}`, { timeout: 15000 });
    if (data && data.ltp) {
      pass(`Live quote  [${symbol}]`, `LTP ₹${data.ltp}`);
    } else {
      fail(`Live quote  [${symbol}]`, "No ltp field in response");
    }
  } catch (e) {
    fail(`Live quote  [${symbol}]`, e.message);
  }
}

// ── 5. Backend /health (optional — only if process already running) ───────────
async function checkBackend() {
  try {
    const port = process.env.PORT || 5000;
    const { data } = await axios.get(`http://localhost:${port}/health`, { timeout: 5000 });
    if (data.status === "ok") {
      pass("Backend /health", `v${data.version || "?"}`);
    } else {
      fail("Backend /health", "unexpected response");
    }
  } catch {
    console.log(`  ${CYAN}⚙ SKIP${RESET}  Backend /health  (not running — start with npm run dev)`);
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${BOLD}FinoLens Healthcheck${RESET}  ${CYAN}${new Date().toISOString()}${RESET}\n`);
  console.log(`  DB  → ${DB_URL.replace(/:\/\/[^@]+@/, "://<credentials>@")}`);
  console.log(`  RD  → ${RD_URL}`);
  console.log(`  ML  → ${ML_BASE}\n`);

  await checkDB();
  await checkRedis();
  await checkML();
  await checkLiveQuote();
  await checkBackend();

  console.log("");
  if (failures === 0) {
    console.log(`${GREEN}${BOLD}All checks passed.${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${RED}${BOLD}${failures} check(s) failed.${RESET}\n`);
    process.exit(1);
  }
})();
