import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { redis } from "../../lib/redis";
import { db } from "../../db/client";
import { users } from "../../db/schema";
import { getFlags } from "../../config/flags";
import { ANON_PENDING_TTL_SECONDS } from "../../config";

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 16;
const MAX_RETRIES = 3;

/** Cost parameters — benchmark on the Pi and tune until ~300ms per hash. */
const ARGON2_OPTIONS = {
    algorithm: "argon2id" as const,
    memoryCost: 65536,
    timeCost: 2,
};

function generateCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    return Array.from(bytes, (b) => BASE62[b % 62]).join("");
}

async function hashCode(code: string): Promise<string> {
    return Bun.password.hash(code, ARGON2_OPTIONS);
}

function anonymousEmail(codeHash: string): string {
    return `${codeHash.substring(0, 12)}@anon.gacha-tracker.app`;
}

export const anonymousAuthPlugin = new Elysia({ name: "anonymous-auth" })
    /**
     * Generate & display code, no account created yet.
     *
     * - Checks the anonymousAccounts feature flag.
     * - Generates a cryptographically random 16-character base62 code.
     * - Hashes it with Argon2id.
     * - Verifies uniqueness against both Redis and the database.
     * - Stores the plaintext code in Redis as `anon_pending:<codeHash>` with a
     *   short TTL so the user has a fixed window to complete Step 2.
     * - Returns the plaintext code to the SPA. No DB write occurs here.
     */
    .post(
        "/api/auth/anonymous/generate",
        async ({ status }) => {
            const flags = await getFlags();
            if (!flags.anonymousAccounts) {
                return status(403, {
                    success: false,
                    error: {
                        code: "ANONYMOUS_ACCOUNTS_DISABLED",
                        message: "Anonymous accounts are not available at this time.",
                    },
                });
            }

            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                const code = generateCode();
                const codeHash = await hashCode(code);
                const redisKey = `anon_pending:${codeHash}`;

                const [existsInRedis, existsInDb] = await Promise.all([
                    redis.exists(redisKey),
                    db.query.users.findFirst({ where: eq(users.codeHash, codeHash) }),
                ]);

                if (existsInRedis || existsInDb) continue;

                await redis.set(redisKey, "1", "EX", ANON_PENDING_TTL_SECONDS);

                return status(200, { success: true, code, expiresIn: ANON_PENDING_TTL_SECONDS });
            }

            return status(500, {
                success: false,
                error: {
                    code: "CODE_GENERATION_FAILED",
                    message: "Failed to generate a unique account code. Please try again.",
                },
            });
        },
        {
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    code: t.String(),
                    expiresIn: t.Number(),
                }),
                403: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                    }),
                }),
                500: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                    }),
                }),
            },
        }
    )

    /**
     * User types the code back in full; account is created.
     *
     * - Hashes the submitted code with Argon2id.
     * - Atomically looks up and deletes the Redis key via Lua GET+DEL (single-use).
     * - Creates the account via Better-Auth's Email signUp API.
     * - Stores codeHash on the user row so the /login endpoint can verify later.
     */
    .post(
        "/api/auth/anonymous/confirm",
        async ({ body, request, status }) => {
            const { code } = body;
            const codeHash = await hashCode(code);
            const redisKey = `anon_pending:${codeHash}`;

            const existed = (await redis.eval(
                `local v = redis.call('GET', KEYS[1])
         if v then redis.call('DEL', KEYS[1]) end
         return v`,
                1,
                redisKey
            )) as string | null;

            if (!existed) {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OR_EXPIRED_CODE",
                        message:
                            "This code has expired or was already used. Please generate a new one.",
                    },
                });
            }

            const session = await auth.api.signUpEmail({
                body: {
                    email: anonymousEmail(codeHash),
                    password: crypto.randomUUID(),
                    name: "Anonymous User",
                },
                headers: request.headers,
            });

            await db
                .update(users)
                .set({ codeHash, isAnonymous: true })
                .where(eq(users.id, session.user.id));

            return { success: true, userId: session.user.id };
        },
        {
            body: t.Object({
                code: t.String({ minLength: CODE_LENGTH, maxLength: CODE_LENGTH }),
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    userId: t.String(),
                }),
                400: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                    }),
                }),
            },
        }
    )

    /**
     * Anonymous code login (used on returning visits).
     *
     * - Fetches all isAnonymous = true accounts.
     * - Verifies the submitted code against each codeHash with Argon2id.
     * - On match, calls Better-Auth's signInEmail with the dummy credentials to
     *   produce a proper session cookie.
     *
     * Note: This is an O(n) operation on the anonymous account count. At the
     * realistic scale of this project this is acceptable. If accounts grow into
     * the tens of thousands, adding a fast-lookup HMAC column alongside the
     * Argon2id hash would allow narrowing candidates before verification.
     *
     * The anonymous feature flag is NOT checked here — existing accounts must
     * always be able to log in even if the generation feature is disabled.
     */
    .post(
        "/api/auth/anonymous/login",
        async ({ body, request, status }) => {
            const { code } = body;

            const candidates = await db.query.users.findMany({
                where: eq(users.isAnonymous, true),
            });

            for (const candidate of candidates) {
                if (
                    candidate.codeHash &&
                    !candidate.deletedAt &&
                    (await Bun.password.verify(code, candidate.codeHash))
                ) {
                    const session = await auth.api.signInEmail({
                        body: {
                            email: anonymousEmail(candidate.codeHash),
                            password: crypto.randomUUID(), // will fail — see below
                        },
                        headers: request.headers,
                    });

                    // Better-Auth's signInEmail verifies the password against the stored
                    // hash, which will fail because the password is random. We need a
                    // different approach: use the admin API to create a session directly.
                    // TODO: replace with auth.api.getSession + manual session creation
                    // once the Better-Auth admin plugin is configured (Phase 3).
                    // For now this endpoint is a placeholder with the correct structure.
                    void session;

                    return status(200, { success: true });
                }
            }

            return status(401, {
                success: false,
                error: {
                    code: "INVALID_CODE",
                    message: "Invalid account code.",
                },
            });
        },
        {
            body: t.Object({
                code: t.String({ minLength: CODE_LENGTH, maxLength: CODE_LENGTH }),
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                }),
                401: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                    }),
                }),
            },
        }
    );
