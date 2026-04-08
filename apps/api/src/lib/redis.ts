import Redis from "ioredis";
import { config } from "../config";

/**
 * Shared Redis client backed by the local bare-metal Redis instance on the Pi.
 *
 * Import this singleton rather than creating additional client instances.
 * ioredis handles reconnection automatically.
 */
export const redis = new Redis(config.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
});

redis.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
});
