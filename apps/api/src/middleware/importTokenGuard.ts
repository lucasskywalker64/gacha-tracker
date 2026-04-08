import { Elysia } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { redis } from "../lib/redis";

/**
 * importTokenGuard
 *
 * Validates a short-lived bearer token issued by POST /pulls/import/token.
 * Tokens are stored in Redis as `import_token:<uuid>` with a 15-minute TTL.
 *
 * Validation uses a Lua GET+DEL to atomically consume the token in a single
 * round-trip, making tokens single-use even under concurrent requests. A second
 * request with the same token receives 401 regardless of timing.
 *
 * On success, attaches `importUserId` (the resolved user ID) to the context.
 * On failure (missing, expired, or already-used token), returns 401.
 *
 * This middleware is used exclusively on the POST /pulls/import endpoint.
 * All other API routes use the session-cookie-based authGuard instead.
 */
export const importTokenGuard = new Elysia({ name: "import-token-guard" })
    .use(bearer())
    .derive({ as: "scoped" }, async ({ bearer, status }) => {
        if (!bearer) {
            return status(401, "Unauthorized: missing or empty bearer token");
        }

        // Atomically consume the Redis key — single-use guarantee.
        // Returns the stored userId on the first call, null on all subsequent ones.
        const userId = (await redis.eval(
            `local v = redis.call('GET', KEYS[1])
       if v then redis.call('DEL', KEYS[1]) end
       return v`,
            1,
            `import_token:${bearer}`
        )) as string | null;

        if (!userId) {
            return status(401, "Unauthorized: invalid or expired import token");
        }

        return { importUserId: userId };
    });
