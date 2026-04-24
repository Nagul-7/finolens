/**
 * Broker abstraction layer.
 *
 * Controlled by the BROKER env variable:
 *   'yfinance' — routes through the Python ML service (default; no broker account needed)
 *   'zerodha'  — Zerodha Kite Connect (stub; fill in API calls when credentials are set)
 *   'angel'    — Angel One SmartAPI (stub; fill in API calls when credentials are set)
 *
 * Every provider must implement the same three methods:
 *   getLiveQuote(symbol)
 *   getHistoricalOHLCV(symbol, interval, from, to)
 *   getOptionsChain(symbol, expiry)
 */

const axios = require("axios");

const BROKER = (process.env.BROKER || "yfinance").toLowerCase();
const ML_BASE = process.env.ML_SERVICE_URL || "http://localhost:8000";

const _mlHttp = axios.create({ baseURL: ML_BASE, timeout: 30_000 });

// ─────────────────────────────────────────────────────────────────────────────
// yfinance provider  (proxies to the Python ML service)
// ─────────────────────────────────────────────────────────────────────────────
const yfinanceProvider = {
  async getLiveQuote(symbol) {
    const { data } = await _mlHttp.get(`/market/quote/${symbol.toUpperCase()}`);
    return data;
  },

  async getHistoricalOHLCV(symbol, interval = "1d", from = null, to = null) {
    const params = { interval };
    if (from) params.from = from;
    if (to)   params.to   = to;
    const { data } = await _mlHttp.get(`/market/ohlcv/${symbol.toUpperCase()}`, { params });
    return data;
  },

  async getOptionsChain(_symbol, _expiry) {
    // yfinance options data is unreliable for Indian markets — not implemented
    throw new Error("Options chain not available via yfinance. Connect a real broker.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Zerodha Kite Connect stub
// ─────────────────────────────────────────────────────────────────────────────
const zerodhaProvider = {
  _kite() {
    // TODO: import KiteConnect, initialise with API key + access token
    // const { KiteConnect } = require("kiteconnect");
    // return new KiteConnect({ api_key: process.env.ZERODHA_API_KEY });
    throw new Error("Zerodha KiteConnect not yet wired up. Set ZERODHA_API_KEY, ZERODHA_API_SECRET, and ZERODHA_ACCESS_TOKEN in .env.");
  },

  async getLiveQuote(symbol) {
    const kite = this._kite();
    const [quote] = await kite.getQuote([`NSE:${symbol.toUpperCase()}`]);
    return {
      symbol: symbol.toUpperCase(),
      price: quote.last_price,
      volume: quote.volume,
      open: quote.ohlc.open,
      high: quote.ohlc.high,
      low: quote.ohlc.low,
      close: quote.ohlc.close,
    };
  },

  async getHistoricalOHLCV(symbol, interval = "day", from, to) {
    const kite = this._kite();
    // Zerodha instrument token lookup required — simplified stub
    const rows = await kite.getHistoricalData(
      `NSE:${symbol.toUpperCase()}`, interval, from, to
    );
    return rows.map((r) => ({
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  },

  async getOptionsChain(symbol, expiry) {
    // TODO: fetch instruments list, filter NFO options for symbol + expiry
    throw new Error("Zerodha options chain stub — implement with kite.getInstruments('NFO').");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Angel One SmartAPI stub
// ─────────────────────────────────────────────────────────────────────────────
const angelProvider = {
  _client() {
    // TODO: import SmartApi, initialise with client ID + MPIN + TOTP
    // const { SmartApi } = require("smartapi-javascript");
    // const client = new SmartApi(process.env.ANGEL_CLIENT_ID);
    // await client.generateSession(process.env.ANGEL_MPIN, process.env.ANGEL_TOTP_SECRET);
    throw new Error("Angel One SmartAPI not yet wired up. Set ANGEL_CLIENT_ID, ANGEL_MPIN, and ANGEL_TOTP_SECRET in .env.");
  },

  async getLiveQuote(symbol) {
    const client = this._client();
    const resp = await client.ltpData("NSE", symbol.toUpperCase(), "");
    return {
      symbol: symbol.toUpperCase(),
      price: resp.data.ltp,
      volume: resp.data.tradingSymbol,
    };
  },

  async getHistoricalOHLCV(symbol, interval = "ONE_DAY", from, to) {
    const client = this._client();
    const params = {
      exchange: "NSE",
      symboltoken: symbol.toUpperCase(),
      interval,
      fromdate: from,
      todate: to,
    };
    const resp = await client.getCandleData(params);
    return resp.data.map(([ts, o, h, l, c, v]) => ({
      date: ts, open: o, high: h, low: l, close: c, volume: v,
    }));
  },

  async getOptionsChain(symbol, expiry) {
    throw new Error("Angel One options chain stub — implement with client.getOptionGreeks().");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Select active provider
// ─────────────────────────────────────────────────────────────────────────────
const _providers = {
  yfinance: yfinanceProvider,
  zerodha:  zerodhaProvider,
  angel:    angelProvider,
};

const provider = _providers[BROKER];
if (!provider) {
  throw new Error(`Unknown BROKER='${BROKER}'. Valid values: yfinance | zerodha | angel`);
}

console.log(`[brokerClient] Active provider: ${BROKER}`);

module.exports = {
  /**
   * Latest price + basic quote for an NSE symbol.
   * @param {string} symbol  e.g. "RELIANCE"
   * @returns {Promise<{symbol, price, volume, ...}>}
   */
  getLiveQuote: (symbol) => provider.getLiveQuote(symbol),

  /**
   * Historical OHLCV bars.
   * @param {string} symbol
   * @param {string} interval  e.g. "1d" | "1h" | "5m"
   * @param {string|null} from  ISO date or null
   * @param {string|null} to    ISO date or null
   * @returns {Promise<Array<{date, open, high, low, close, volume}>>}
   */
  getHistoricalOHLCV: (symbol, interval, from, to) =>
    provider.getHistoricalOHLCV(symbol, interval, from, to),

  /**
   * Options chain for a symbol and expiry.
   * @param {string} symbol
   * @param {string} expiry  e.g. "2025-05-29"
   */
  getOptionsChain: (symbol, expiry) => provider.getOptionsChain(symbol, expiry),

  /** Expose which provider is active for health/debug endpoints. */
  activeBroker: BROKER,
};
