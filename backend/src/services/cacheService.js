const { getRedis } = require("../config/redis");

const TTL = parseInt(process.env.CACHE_TTL_SECONDS || "300", 10);

async function get(key) {
  try {
    const raw = await getRedis().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function set(key, value, ttl = TTL) {
  try {
    await getRedis().set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Cache write failure is non-fatal
  }
}

async function del(key) {
  try {
    await getRedis().del(key);
  } catch {}
}

module.exports = { get, set, del };
