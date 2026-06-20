import { redis } from "./redis";

export interface RateLimitResult {
    limited: boolean;
    remaining: number;
    retryAfter: number; // Seconds until reset
}

/**
 * Atomic fixed-window rate limiter using Redis.
 * Race-free implementation (INCR first, then limit and expire checks).
 */
export async function checkRateLimit(options: {
    ip: string; // The rate limit identifier (e.g. IP or userId)
    action: string;
    limit: number;
    windowSeconds: number;
}): Promise<RateLimitResult> {
    const { ip, action, limit, windowSeconds } = options;
    const key = `rate_limit:${action}:${ip}`;

    const newCount = await redis.incr(key);

    // If it's a new key, set the expiry window
    if (newCount === 1) {
        await redis.expire(key, windowSeconds);
    }

    if (newCount > limit) {
        const ttl = await redis.ttl(key);
        return {
            limited: true,
            remaining: 0,
            retryAfter: ttl > 0 ? ttl : windowSeconds,
        };
    }

    const ttl = await redis.ttl(key);

    return {
        limited: false,
        remaining: Math.max(0, limit - newCount),
        retryAfter: ttl > 0 ? ttl : windowSeconds,
    };
}
