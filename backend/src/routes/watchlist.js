const express = require("express");
const fs      = require("fs");
const path    = require("path");
const db = require("../config/database");
const axios = require("axios");
const cacheService = require("../services/cacheService");

const router = express.Router();
const ML = axios.create({ baseURL: process.env.ML_SERVICE_URL || "http://localhost:8000", timeout: 30000 });

const WATCHLIST_FILE = path.join(__dirname, "../../data/watchlist.json");

function loadWatchlistFile() {
  try {
    const dir = path.dirname(WATCHLIST_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(WATCHLIST_FILE)) {
      const defaults = ["RELIANCE", "HDFCBANK", "TCS", "INFY"];
      fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE, "utf8"));
  } catch (e) {
    console.error("[watchlist] load failed:", e.message);
    return ["RELIANCE", "HDFCBANK", "TCS", "INFY"];
  }
}

function saveWatchlistFile(symbols) {
  try {
    fs.mkdirSync(path.dirname(WATCHLIST_FILE), { recursive: true });
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(symbols, null, 2));
  } catch (e) {
    console.error("[watchlist] file save failed:", e.message);
  }
}

// In-memory fallback when DB is unavailable (seeded from file)
let _memWatchlist = loadWatchlistFile();

async function getWatchlistSymbols() {
  try {
    const { rows } = await db.query(
      "SELECT symbol FROM watchlist ORDER BY created_at ASC"
    );
    return rows.map((r) => r.symbol);
  } catch {
    return _memWatchlist;
  }
}

// GET /api/watchlist
router.get("/", async (req, res) => {
  const symbols = await getWatchlistSymbols();
  return res.json(symbols);
});

// POST /api/watchlist  { symbol }
router.post("/", async (req, res) => {
  const symbol = (req.body.symbol || "").toUpperCase().trim();
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    await db.query(
      "INSERT INTO watchlist (symbol) VALUES ($1) ON CONFLICT (symbol) DO NOTHING",
      [symbol]
    );
  } catch {}

  // Always keep memory + file in sync regardless of DB outcome
  if (!_memWatchlist.includes(symbol)) {
    _memWatchlist.push(symbol);
    saveWatchlistFile(_memWatchlist);
  }
  return res.status(201).json({ symbol });
});

// GET /api/watchlist/quotes  — live quotes for all watchlist symbols
router.get("/quotes", async (req, res) => {
  const symbols = await getWatchlistSymbols();

  const quotes = await Promise.allSettled(
    symbols.map(async (sym) => {
      const cacheKey = `finolens:quote:${sym}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) return { ...cached, cached: true };

      const { data } = await ML.get(`/market/quote/${sym}`);
      await cacheService.set(cacheKey, data, 60);
      return data;
    })
  );

  const result = quotes
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);

  return res.json(result);
});

// DELETE /api/watchlist/:symbol
router.delete("/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase().trim();
  try {
    await db.query("DELETE FROM watchlist WHERE symbol = $1", [symbol]);
  } catch {}

  // Always keep memory + file in sync
  _memWatchlist = _memWatchlist.filter((s) => s !== symbol);
  saveWatchlistFile(_memWatchlist);
  return res.json({ removed: symbol });
});

module.exports = router;
