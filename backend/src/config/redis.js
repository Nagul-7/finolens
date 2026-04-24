const Redis = require("ioredis");

let client = null;

function getRedis() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
    });

    client.on("error", (err) => {
      // Non-fatal — the app degrades gracefully without Redis
      console.warn("[Redis] Connection error:", err.message);
    });

    client.on("connect", () => console.log("[Redis] Connected"));
  }
  return client;
}

module.exports = { getRedis };
