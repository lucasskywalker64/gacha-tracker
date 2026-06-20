import { Elysia, t } from "elysia";
import { auth } from "./auth";
import { anonymousAuthPlugin } from "./anonymous";
import { db } from "../../db/client";
import { user, userEmails, account, verification } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { config } from "../../config";
import { signSessionToken } from "./auth";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";
import { checkRateLimit } from "../../lib/rateLimit";
import { randomInt } from "node:crypto";
import { sendConflictOtpEmail } from "../../lib/email";

export function validateCallbackURL(candidate: string): boolean {
    try {
        const parsedCandidate = new URL(candidate);
        const parsedAllowed = new URL(config.FRONTEND_URL);
        return parsedCandidate.origin === parsedAllowed.origin;
    } catch {
        return false;
    }
}

/**
 * Auth Elysia plugin.
 *
 * - Mounts Better-Auth's handler at /api/auth/* via `.mount()`.
 * - Provides a `.macro` for route-level session enforcement that other plugins
 *   can use by passing `{ auth: true }` to a route definition.
 * - Includes the anonymous auth endpoints from anonymousAuthPlugin.
 */
export const authPlugin = new Elysia({ prefix: "/auth" })
    .use(anonymousAuthPlugin)
    .post(
        "/sign-in/email",
        async ({ body, status, set, request }) => {
            const { email, password, rememberMe } = body;
            const emailLower = email.toLowerCase().trim();

            // Check if this is a verified secondary email
            const secondary = await db.query.userEmails.findFirst({
                where: and(eq(userEmails.email, emailLower), eq(userEmails.verified, true)),
            });

            let targetEmail = emailLower;

            if (secondary) {
                const primaryUser = await db.query.user.findFirst({
                    where: eq(user.id, secondary.userId),
                });
                if (primaryUser) {
                    targetEmail = primaryUser.email;
                }
            }

            // Forward the request to Better-Auth's standard handler internally
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const response = await (auth.api as any).signInEmail({
                    body: {
                        email: targetEmail,
                        password,
                        rememberMe,
                    },
                    headers: request.headers,
                    asResponse: true,
                });

                set.status = response.status;
                // Copy headers
                response.headers.forEach((value: string, key: string) => {
                    set.headers[key] = value;
                });

                return await response.json();
            } catch (e) {
                return status(400, {
                    success: false,
                    error: e instanceof Error ? e.message : "Failed to sign in.",
                });
            }
        },
        {
            body: t.Object({
                email: t.String(),
                password: t.String(),
                rememberMe: t.Optional(t.Boolean()),
            }),
        }
    )
    .get(
        "/conflict-details",
        async ({ query, status, request }) => {
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const rateLimit = await checkRateLimit({
                ip,
                action: "auth_conflict_api",
                limit: 10,
                windowSeconds: 60,
            });

            if (rateLimit.limited) {
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: "Rate limit exceeded. Please try again in a minute.",
                    },
                });
            }

            const resolvedToken = query.token || "";

            if (!resolvedToken) {
                return status(400, {
                    success: false,
                    error: {
                        code: "EXPIRED_CONFLICT_TOKEN",
                        message:
                            "This authorization attempt has expired. Please try signing in again.",
                    },
                });
            }

            const stored = await redis.get(RedisKeys.authConflict(resolvedToken));
            if (!stored) {
                return status(400, {
                    success: false,
                    error: {
                        code: "EXPIRED_CONFLICT_TOKEN",
                        message:
                            "This authorization attempt has expired. Please try signing in again.",
                    },
                });
            }

            let data;
            try {
                data = JSON.parse(stored) as {
                    maskedEmail: string;
                    realEmail: string;
                    userId: string;
                    provider: string;
                    accountData: Record<string, unknown>;
                };
            } catch {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_CONFLICT_TOKEN",
                        message: "The token is invalid.",
                    },
                });
            }

            return {
                success: true,
                email: data.maskedEmail,
                provider: data.provider,
                token: resolvedToken,
            };
        },
        {
            query: t.Object({
                token: t.Optional(t.String()),
            }),
        }
    )
    .post(
        "/conflict/send-otp",
        async ({ body, status, request }) => {
            const { conflictToken } = body;

            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";

            const stored = await redis.get(RedisKeys.authConflict(conflictToken));
            if (!stored) {
                return status(400, {
                    success: false,
                    error: { code: "EXPIRED_CONFLICT_TOKEN", message: "Conflict session expired." },
                });
            }

            let data;
            try {
                data = JSON.parse(stored) as {
                    maskedEmail: string;
                    realEmail: string;
                    userId: string;
                    provider: string;
                    accountData: Record<string, unknown>;
                };
            } catch {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_CONFLICT_TOKEN",
                        message: "The token is invalid.",
                    },
                });
            }

            const [ipLimit, emailLimit] = await Promise.all([
                checkRateLimit({
                    ip,
                    action: "conflict_otp_send_ip",
                    limit: 5,
                    windowSeconds: 300,
                }),
                checkRateLimit({
                    ip: data.realEmail,
                    action: "conflict_otp_send_email",
                    limit: 3,
                    windowSeconds: 300,
                }),
            ]);

            if (ipLimit.limited || emailLimit.limited) {
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: "Rate limit exceeded. Please wait before requesting a new code.",
                    },
                });
            }

            const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

            await redis.set(
                RedisKeys.authConflictOtp(conflictToken),
                JSON.stringify({
                    code,
                    email: data.realEmail,
                    userId: data.userId,
                    provider: data.provider,
                    accountData: data.accountData,
                    failedAttempts: 0,
                }),
                "EX",
                300
            );

            await sendConflictOtpEmail({ email: data.realEmail, code, provider: data.provider });

            return { success: true, maskedEmail: data.maskedEmail };
        },
        {
            body: t.Object({ conflictToken: t.String() }),
        }
    )
    .post(
        "/conflict/verify-otp",
        async ({ body, status, cookie, request }) => {
            const { conflictToken, code } = body;

            const raw = await redis.get(RedisKeys.authConflictOtp(conflictToken));
            if (!raw) {
                return status(409, {
                    success: false,
                    error: {
                        code: "CONFLICT_EXPIRED",
                        message: "This session has expired. Please try signing in again.",
                    },
                });
            }

            const stored = JSON.parse(raw) as {
                code: string;
                email: string;
                userId: string;
                provider: string;
                accountData: Record<string, unknown>;
                failedAttempts: number;
            };

            if (stored.code !== code) {
                const attempts = stored.failedAttempts + 1;
                if (attempts >= 5) {
                    await redis.del(RedisKeys.authConflictOtp(conflictToken));
                    await redis.del(RedisKeys.authConflict(conflictToken));
                    return status(429, {
                        success: false,
                        error: {
                            code: "MAX_ATTEMPTS_EXCEEDED",
                            message: "Too many incorrect attempts. Please start over.",
                        },
                    });
                }
                const ttl = await redis.ttl(RedisKeys.authConflictOtp(conflictToken));
                await redis.set(
                    RedisKeys.authConflictOtp(conflictToken),
                    JSON.stringify({ ...stored, failedAttempts: attempts }),
                    "EX",
                    ttl > 0 ? ttl : 300
                );
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OTP",
                        message: "The code is incorrect. Please try again.",
                    },
                });
            }

            await redis.del(RedisKeys.authConflictOtp(conflictToken));
            await redis.del(RedisKeys.authConflict(conflictToken));

            const dbAccountData = stored.accountData as {
                id?: string;
                accountId: string;
                providerId: string;
                accessToken?: string | null;
                refreshToken?: string | null;
                idToken?: string | null;
                accessTokenExpiresAt?: string | number | Date | null;
                refreshTokenExpiresAt?: string | number | Date | null;
                scope?: string | null;
                password?: string | null;
            };
            await db.insert(account).values({
                id: dbAccountData.id || crypto.randomUUID(),
                userId: stored.userId,
                accountId: dbAccountData.accountId,
                providerId: dbAccountData.providerId,
                accessToken: dbAccountData.accessToken,
                refreshToken: dbAccountData.refreshToken,
                idToken: dbAccountData.idToken,
                accessTokenExpiresAt: dbAccountData.accessTokenExpiresAt
                    ? new Date(dbAccountData.accessTokenExpiresAt)
                    : null,
                refreshTokenExpiresAt: dbAccountData.refreshTokenExpiresAt
                    ? new Date(dbAccountData.refreshTokenExpiresAt)
                    : null,
                scope: dbAccountData.scope,
                password: dbAccountData.password,
            });

            const authCtx = await auth.$context;
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const userAgent = request.headers.get("user-agent") || "";
            const sessionVal = await authCtx.internalAdapter.createSession(stored.userId, false, {
                ipAddress: ip,
                userAgent: userAgent,
            });
            const cookieConfig = authCtx.authCookies.sessionToken;
            const signedToken = await signSessionToken(sessionVal.token);

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

            return { success: true };
        },
        {
            body: t.Object({ conflictToken: t.String(), code: t.String() }),
        }
    )
    .post(
        "/otp/send",
        async ({ body, status, request }) => {
            const { email } = body;
            const inputEmail = email.toLowerCase().trim();

            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";

            const [ipLimit, emailLimit] = await Promise.all([
                checkRateLimit({ ip, action: "otp_send_ip", limit: 10, windowSeconds: 300 }),
                checkRateLimit({
                    ip: inputEmail,
                    action: "otp_send_email",
                    limit: 5,
                    windowSeconds: 300,
                }),
            ]);

            if (ipLimit.limited || emailLimit.limited) {
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: "Rate limit exceeded. Please wait before requesting a new code.",
                    },
                });
            }

            const authApi = auth.api as unknown as {
                sendVerificationOTP: (args: {
                    body: {
                        email: string;
                        type: "sign-in" | "email-verification" | "forget-password";
                    };
                    headers: Headers;
                }) => Promise<unknown>;
            };
            await authApi.sendVerificationOTP({
                body: { email: inputEmail, type: "sign-in" },
                headers: request.headers,
            });

            return { success: true };
        },
        {
            body: t.Object({ email: t.String() }),
        }
    )
    .post(
        "/sign-in/email-otp",
        async ({ body, status, set, cookie, request }) => {
            const { email, otp } = body;
            const emailLower = email.toLowerCase().trim();

            // Check if this is a verified secondary email
            const secondary = await db.query.userEmails.findFirst({
                where: and(eq(userEmails.email, emailLower), eq(userEmails.verified, true)),
            });

            if (!secondary) {
                // Not a secondary email. Query verification records to enforce failed attempt limit.
                const records = await db.query.verification.findMany({
                    where: eq(verification.identifier, `sign-in-otp-${emailLower}`),
                });

                // Find the record matching the code
                const record = records.find((r) => {
                    const [storedOtp] = r.value.split(":");
                    return storedOtp === otp;
                });

                if (record && record.expiresAt >= new Date()) {
                    // Update record in database to strip attempts suffix if any, so Better-Auth parses it correctly.
                    const [storedOtp] = record.value.split(":");
                    await db
                        .update(verification)
                        .set({ value: storedOtp })
                        .where(eq(verification.id, record.id));

                    // Forward to Better-Auth's standard handler.
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const response = await (auth.api as any).signInEmailOTP({
                            body: {
                                email: emailLower,
                                otp,
                            },
                            headers: request.headers,
                            asResponse: true,
                        });

                        set.status = response.status;
                        response.headers.forEach((value: string, key: string) => {
                            set.headers[key] = value;
                        });

                        return await response.json();
                    } catch (e) {
                        return status(400, {
                            success: false,
                            error: e instanceof Error ? e.message : "Failed to sign in.",
                        });
                    }
                }

                // If we reached here, either the code was wrong, or it was expired.
                // Let's find the latest unexpired record to increment failed attempts on.
                const activeRecords = records.filter((r) => r.expiresAt >= new Date());
                activeRecords.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
                const latestRecord = activeRecords[0];

                if (latestRecord) {
                    const [storedOtp, attemptsStr] = latestRecord.value.split(":");
                    const attempts = parseInt(attemptsStr || "0", 10);
                    const newAttempts = attempts + 1;
                    if (newAttempts >= 5) {
                        await db.delete(verification).where(eq(verification.id, latestRecord.id));
                    } else {
                        await db
                            .update(verification)
                            .set({ value: `${storedOtp}:${newAttempts}` })
                            .where(eq(verification.id, latestRecord.id));
                    }
                }

                return status(400, {
                    success: false,
                    error: {
                        message: "Invalid or expired verification code.",
                    },
                });
            }

            // It IS a secondary email. Let's verify the OTP manually.
            const records = await db.query.verification.findMany({
                where: eq(verification.identifier, `sign-in-otp-${emailLower}`),
            });

            // Find the record matching the code
            const record = records.find((r) => {
                const [storedOtp] = r.value.split(":");
                return storedOtp === otp;
            });

            if (record && record.expiresAt >= new Date()) {
                // Consume/delete the verification record
                await db.delete(verification).where(eq(verification.id, record.id));

                // Fetch the primary user record
                const primaryUser = await db.query.user.findFirst({
                    where: eq(user.id, secondary.userId),
                });

                if (!primaryUser) {
                    return status(400, {
                        success: false,
                        error: {
                            message: "Associated user not found.",
                        },
                    });
                }

                // Sign the user in by creating a session manually
                const authCtx = await auth.$context;
                const ip =
                    request.headers.get("x-forwarded-for") ??
                    request.headers.get("x-real-ip") ??
                    "127.0.0.1";
                const userAgent = request.headers.get("user-agent") || "";
                const sessionVal = await authCtx.internalAdapter.createSession(
                    primaryUser.id,
                    false,
                    {
                        ipAddress: ip,
                        userAgent: userAgent,
                    }
                );
                const cookieConfig = authCtx.authCookies.sessionToken;
                const signedToken = await signSessionToken(sessionVal.token);

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

                return {
                    session: sessionVal,
                    user: {
                        id: primaryUser.id,
                        email: primaryUser.email,
                        emailVerified: primaryUser.emailVerified,
                        name: primaryUser.name,
                        image: primaryUser.image,
                        createdAt: primaryUser.createdAt,
                        updatedAt: primaryUser.updatedAt,
                    },
                    token: signedToken,
                };
            }

            // If we reached here, either the code was wrong, or it was expired.
            // Let's find the latest unexpired record to increment failed attempts on.
            const activeRecords = records.filter((r) => r.expiresAt >= new Date());
            activeRecords.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            const latestRecord = activeRecords[0];

            if (latestRecord) {
                const [storedOtp, attemptsStr] = latestRecord.value.split(":");
                const attempts = parseInt(attemptsStr || "0", 10);
                const newAttempts = attempts + 1;
                if (newAttempts >= 5) {
                    await db.delete(verification).where(eq(verification.id, latestRecord.id));
                } else {
                    await db
                        .update(verification)
                        .set({ value: `${storedOtp}:${newAttempts}` })
                        .where(eq(verification.id, latestRecord.id));
                }
            }

            return status(400, {
                success: false,
                error: {
                    message: "Invalid or expired verification code.",
                },
            });
        },
        {
            body: t.Object({
                email: t.String(),
                otp: t.String(),
            }),
        }
    )
    .mount(auth.handler)
    .macro({
        auth: {
            async resolve({ status, request: { headers } }) {
                const session = await auth.api.getSession({ headers });
                if (!session) return status(401);
                return {
                    user: session.user,
                    session: session.session,
                };
            },
        },
    });

export { auth, getUserAuthMethodsCount, assertUserOwnsEmail, signJWT, verifyJWT } from "./auth";
export type { Auth } from "./auth";
