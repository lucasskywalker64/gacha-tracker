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

/**
 * Creates a dedicated Redis client for use as a pub/sub subscriber.
 * ioredis does not allow a connection in SUBSCRIBE mode to send
 * regular commands — callers MUST use a separate client instance.
 * Remember to call .unsubscribe() + .quit() when done.
 */
export function createSubscriberClient(): Redis {
    const client = new Redis(config.REDIS_URL, {
        enableOfflineQueue: true,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
    });
    client.on("error", (err) => {
        console.error("[redis:subscriber] connection error:", err.message);
    });
    return client;
}
