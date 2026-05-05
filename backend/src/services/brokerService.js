"use strict";
/**
 * brokerService — unified order interface.
 *
 * BROKER_MODE=paper  → all orders route to algoEngine paper trades (default).
 * BROKER_MODE=live   → swap placeBuyOrder / placeSellOrder implementations
 *                       to call the real broker REST API using BROKER_API_KEY /
 *                       BROKER_API_SECRET / BROKER_ACCESS_TOKEN from .env.
 *
 * Only this file needs to change when a real broker is connected.
 */

const algoEngine = require("./algoEngine");

const MODE = (process.env.BROKER_MODE || "paper").toLowerCase();

// ─── Paper implementations ────────────────────────────────────────────────────
async function _paperBuy(symbol, qty, price) {
  return algoEngine.placePaperTrade(symbol, "BUY", qty, price);
}

async function _paperSell(symbol, qty, price) {
  return algoEngine.placePaperTrade(symbol, "SELL", qty, price);
}

function _paperPositions() {
  return algoEngine.getOpenPositions();
}

function _paperOrderHistory() {
  return algoEngine.getClosedTrades();
}

// ─── Live stubs (wire up real broker SDK here) ────────────────────────────────
async function _liveBuy(symbol, qty, price) {
  throw new Error("Live broker not configured — set BROKER_MODE=paper or implement _liveBuy");
}

async function _liveSell(symbol, qty, price) {
  throw new Error("Live broker not configured — set BROKER_MODE=paper or implement _liveSell");
}

async function _livePositions() {
  throw new Error("Live broker not configured");
}

async function _liveOrderHistory() {
  throw new Error("Live broker not configured");
}

// ─── Public API ───────────────────────────────────────────────────────────────
const brokerService = {
  mode: MODE,

  /**
   * Place a buy order.
   * @param {string} symbol  NSE symbol (e.g. "RELIANCE")
   * @param {number} qty     Number of shares
   * @param {number} price   0 or falsy = market order
   */
  async placeBuyOrder(symbol, qty, price = 0) {
    return MODE === "live" ? _liveBuy(symbol, qty, price) : _paperBuy(symbol, qty, price);
  },

  /**
   * Place a sell / short order.
   */
  async placeSellOrder(symbol, qty, price = 0) {
    return MODE === "live" ? _liveSell(symbol, qty, price) : _paperSell(symbol, qty, price);
  },

  /**
   * Fetch open positions.
   */
  async getPositions() {
    return MODE === "live" ? _livePositions() : _paperPositions();
  },

  /**
   * Fetch closed trade history.
   */
  async getOrderHistory() {
    return MODE === "live" ? _liveOrderHistory() : _paperOrderHistory();
  },
};

module.exports = brokerService;
