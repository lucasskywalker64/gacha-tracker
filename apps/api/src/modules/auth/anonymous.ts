import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { auth, generateSessionToken, signSessionToken } from "./auth";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";
import { db } from "../../db/client";
import { user, session } from "../../db/schema";
import { getFlags } from "../../config/flags";
import { ANON_PENDING_TTL_SECONDS } from "../../config";
import { checkRateLimit } from "../../lib/rateLimit";

const BASE10 = "0123456789";
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
    return Array.from(bytes, (b) => BASE10[b % 10]).join("");
}

function getIdentifier(code: string): string {
    return Bun.SHA256.hash(code, "hex");
}

async function hashCode(code: string): Promise<string> {
    return Bun.password.hash(code, ARGON2_OPTIONS);
}

function anonymousEmail(identifier: string): string {
    return `${identifier.substring(0, 12)}@anon.gacha-tracker.app`;
}

// Compute timing-safe dummy hash once at application start-up
const DUMMY_HASH = await Bun.password.hash("00000000000000000000000000000000", ARGON2_OPTIONS);

export const anonymousAuthPlugin = new Elysia({ name: "anonymous-auth" })
    /**
     * Generate & display code, no account created yet.
     *
     * - Checks the anonymousAccounts feature flag.
     * - Generates a cryptographically random 16-digit code.
     * - Derives a deterministic identifier (SHA-256) for lookups and emails.
     * - Verifies uniqueness against Redis and the database (via derived email).
     * - Stores a placeholder in Redis as `anon_pending:<identifier>` with a
     *   short TTL so the user has a fixed window to complete Step 2.
     * - Returns the plaintext code to the SPA. No DB write occurs here.
     */
    .post(
        "/anonymous/generate",
        async ({ request, status, set }) => {
            // Apply IP rate limiting: 5 requests per 15 minutes
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const rate = await checkRateLimit({
                ip,
                action: "anon_gen",
                limit: 5,
                windowSeconds: 900,
            });

            if (rate.limited) {
                set.headers["Retry-After"] = rate.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many account generation requests. Please try again in ${Math.ceil(rate.retryAfter / 60)} minutes.`,
                        retryAfter: rate.retryAfter,
                    },
                });
            }

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
                const identifier = getIdentifier(code);
                const email = anonymousEmail(identifier);
                const redisKey = RedisKeys.anonPending(identifier);

                const [existsInRedis, existsInDb] = await Promise.all([
                    redis.exists(redisKey),
                    db.query.user.findFirst({ where: eq(user.email, email) }),
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
                429: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                        retryAfter: t.Number(),
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
     * - Derives the deterministic identifier (SHA-256) for the Redis lookup.
     * - Atomically looks up and deletes the Redis key (single-use).
     * - Creates the account via Better-Auth's Email signUp API using the derived email.
     * - Hashes the code with Argon2id and stores it on the user row for verification.
     */
    .post(
        "/anonymous/confirm",
        async ({ body, request, status, set }) => {
            // Apply IP rate limiting: 10 requests per minute
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const rate = await checkRateLimit({
                ip,
                action: "anon_confirm",
                limit: 10,
                windowSeconds: 60,
            });

            if (rate.limited) {
                set.headers["Retry-After"] = rate.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many confirmation attempts. Please try again in ${rate.retryAfter} seconds.`,
                        retryAfter: rate.retryAfter,
                    },
                });
            }

            const { code } = body;
            const identifier = getIdentifier(code);
            const redisKey = RedisKeys.anonPending(identifier);

            const existed = (await redis.getdel(redisKey)) as string | null;

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

            try {
                const codeHash = await hashCode(code);
                const response = await auth.api.signUpEmail({
                    body: {
                        email: anonymousEmail(identifier),
                        password: crypto.randomUUID(),
                        name: "Anonymous User",
                        isAnonymous: true,
                        codeHash,
                    } as unknown as { name: string; email: string; password: string },
                    headers: request.headers,
                    asResponse: true,
                });

                const setCookie = response.headers.get("set-cookie");
                if (!setCookie) {
                    throw new Error("Login successful, but session could not be established.");
                }

                set.headers["Set-Cookie"] = setCookie;

                const result = (await response.json()) as { user: { id: string } };
                return status(200, { success: true, userId: result.user.id });
            } catch (e) {
                return status(400, {
                    success: false,
                    error: {
                        code: "SIGNUP_FAILED",
                        message:
                            e instanceof Error ? e.message : "Failed to create anonymous account.",
                    },
                });
            }
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
                429: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                        retryAfter: t.Number(),
                    }),
                }),
            },
        }
    )

    /**
     * Anonymous code login (used on returning visits).
     *
     * - Derives the deterministic email from the submitted code.
     * - Performs an O(1) lookup in the database for the candidate user.
     * - Verifies the code against the stored Argon2id codeHash.
     * - On match, sets a session cookie manually.
     *
     * The anonymous feature flag is NOT checked here — existing accounts must
     * always be able to log in even if the generation feature is disabled.
     */
    .post(
        "/anonymous/login",
        async ({ body, status, set, cookie, request }) => {
            // Apply IP rate limiting: 10 requests per minute
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const rate = await checkRateLimit({
                ip,
                action: "anon_login",
                limit: 10,
                windowSeconds: 60,
            });

            if (rate.limited) {
                set.headers["Retry-After"] = rate.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many login attempts. Please try again in ${rate.retryAfter} seconds.`,
                        retryAfter: rate.retryAfter,
                    },
                });
            }

            const { code } = body;
            const identifier = getIdentifier(code);
            const email = anonymousEmail(identifier);

            const candidate = await db.query.user.findFirst({
                where: eq(user.email, email),
            });

            let isValid = false;
            if (candidate && candidate.codeHash) {
                isValid = await Bun.password.verify(code, candidate.codeHash);
            } else {
                // Timing oracle protection: verify against precomputed DUMMY_HASH to consume timing-equivalent cycles
                await Bun.password.verify(code, DUMMY_HASH);
            }

            if (isValid && candidate) {
                const rawToken = generateSessionToken();
                const signedToken = await signSessionToken(rawToken);
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

                const sessionId = crypto.randomUUID();
                const sessionRecord = {
                    id: sessionId,
                    token: rawToken,
                    userId: candidate.id,
                    expiresAt,
                    ipAddress:
                        request.headers.get("x-forwarded-for") ??
                        request.headers.get("x-real-ip") ??
                        undefined,
                    userAgent: request.headers.get("user-agent") ?? undefined,
                };

                await db.insert(session).values(sessionRecord);

                try {
                    const sessionData = {
                        session: {
                            ...sessionRecord,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        },
                        user: candidate,
                    };
                    await redis.set(rawToken, JSON.stringify(sessionData), "EX", 7 * 24 * 60 * 60);
                } catch {
                    // best-effort session caching
                }

                const authCtx = await auth.$context;
                const cookieConfig = authCtx.authCookies.sessionToken;
                const sameSiteRaw = cookieConfig.attributes.sameSite;
                const sameSite =
                    typeof sameSiteRaw === "string"
                        ? (sameSiteRaw.toLowerCase() as "lax" | "strict" | "none")
                        : undefined;

                cookie[cookieConfig.name].set({
                    value: signedToken,
                    ...cookieConfig.attributes,
                    sameSite,
                });

                return status(200, { success: true });
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
                403: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                    }),
                }),
                429: t.Object({
                    success: t.Boolean(),
                    error: t.Object({
                        code: t.String(),
                        message: t.String(),
                        retryAfter: t.Number(),
                    }),
                }),
            },
        }
    );
