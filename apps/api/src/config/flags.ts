import { z } from "zod";
import { db } from "../db/client";
import { featureFlag } from "../db/schema";
import { redis } from "../lib/redis";

const REDIS_FLAGS_KEY = "flags";

/**
 * Schema for the feature_flags table.
 *
 * Unknown flags returned from the database are stripped by Zod. Adding a new
 * flag requires:
 *   1. Adding it here with a sensible default.
 *   2. Inserting a row in feature_flags via a Drizzle migration seed.
 *
 * Defaults here act as the fallback if the DB row is missing — useful during
 * development before the seed migration has run.
 */
const flagSchema = z.object({
    starrail: z.boolean().default(true),
    genshin: z.boolean().default(true),
    zzz: z.boolean().default(true),
    wuwa: z.boolean().default(true),
    anonymousAccounts: z.boolean().default(true),
    experimentalLuckScore: z.boolean().default(false),
});

export type Flags = z.infer<typeof flagSchema>;

/**
 * Returns the current feature flags.
 *
 * Cache strategy: Redis with no TTL — correctness is guaranteed entirely by
 * explicit invalidation on every write (see {@link invalidateFlags}).
 *
 * On a cache miss, reads from Turso and warms the cache.
 */
export async function getFlags(): Promise<Flags> {
    try {
        const cached = await redis.get(REDIS_FLAGS_KEY);
        if (cached) {
            const parsed = flagSchema.safeParse(JSON.parse(cached));
            if (parsed.success) return parsed.data;
        }
    } catch (error) {
        console.warn("Failed to parse cached feature flags:", error);
    }

    const rows = await db.select().from(featureFlag);
    const obj = Object.fromEntries(rows.map((r) => [r.key, r.enabled === 1]));
    const flags = flagSchema.parse(obj);

    await redis.set(REDIS_FLAGS_KEY, JSON.stringify(flags));
    return flags;
}

/**
 * Invalidates the Redis flags cache.
 * Must be called after every write to the feature_flags table.
 */
export async function invalidateFlags(): Promise<void> {
    await redis.del(REDIS_FLAGS_KEY);
}
