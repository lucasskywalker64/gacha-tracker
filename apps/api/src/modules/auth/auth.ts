import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { config } from "../../config";
import * as schema from "../../db/schema";
import { sendOtpEmail } from "../../lib/email";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { anonymousAuthPlugin } from "./anonymous";
import { APIError, getOAuthState } from "better-auth/api";
import { createHmac, timingSafeEqual } from "node:crypto";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";
import { socialProvidersConfig } from "./social";

interface BetterAuthHookContext {
    request?: Request;
    setCookie?: (
        name: string,
        value: string,
        options?: {
            maxAge?: number;
            path?: string;
            secure?: boolean;
            httpOnly?: boolean;
            sameSite?: "lax" | "strict" | "none";
        }
    ) => void;
}

export function signJWT(payload: Record<string, unknown>, secret: string): string {
    const header = { alg: "HS256", typ: "JWT" };
    const headerPart = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const unsignedToken = `${headerPart}.${payloadPart}`;
    const signature = createHmac("sha256", secret).update(unsignedToken).digest("base64url");
    return `${unsignedToken}.${signature}`;
}

export function verifyJWT(token: string, secret: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const unsignedToken = `${headerPart}.${payloadPart}`;
    const expectedSignature = createHmac("sha256", secret)
        .update(unsignedToken)
        .digest("base64url");

    const sigA = Buffer.from(signaturePart);
    const sigB = Buffer.from(expectedSignature);
    if (sigA.length !== sigB.length || !timingSafeEqual(sigA, sigB)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

export async function getUserAuthMethodsCount(userId: string): Promise<{
    primaryEmail: string | null;
    secondaryEmails: Array<{ email: string; verified: boolean; verifiedAt: string | null }>;
    socialAccounts: Array<{ providerId: string }>;
    hasAnonymousCode: boolean;
    totalActiveCount: number;
}> {
    const [userRecord, secondary, social] = await Promise.all([
        db.query.user.findFirst({
            where: eq(schema.user.id, userId),
        }),
        db.query.userEmails.findMany({
            where: eq(schema.userEmails.userId, userId),
            orderBy: (emails, { asc }) => [asc(emails.createdAt)],
        }),
        db.query.account.findMany({
            where: eq(schema.account.userId, userId),
        }),
    ]);

    if (!userRecord) {
        return {
            primaryEmail: null,
            secondaryEmails: [],
            socialAccounts: [],
            hasAnonymousCode: false,
            totalActiveCount: 0,
        };
    }

    const primaryEmailReal = !userRecord.email.endsWith("@anon.gacha-tracker.app");

    const hasAnonymousCode = !!(userRecord.isAnonymous && userRecord.codeHash);

    // Count how many active login methods there are:
    let totalActiveCount = 0;
    if (primaryEmailReal) totalActiveCount++;
    totalActiveCount += secondary.filter((e) => e.verified).length;
    totalActiveCount += social.length;
    if (hasAnonymousCode) totalActiveCount++;

    return {
        primaryEmail: primaryEmailReal ? userRecord.email : null,
        secondaryEmails: secondary.map((e) => ({
            email: e.email,
            verified: !!e.verified,
            verifiedAt: e.verifiedAt ? e.verifiedAt.toISOString() : null,
        })),
        socialAccounts: social.map((a) => ({ providerId: a.providerId })),
        hasAnonymousCode: hasAnonymousCode,
        totalActiveCount,
    };
}

export async function assertUserOwnsEmail(
    userId: string,
    emailLower: string,
    userRecord: { email: string }
): Promise<boolean> {
    const isPrimary =
        userRecord.email === emailLower && !userRecord.email.endsWith("@anon.gacha-tracker.app");
    if (isPrimary) return true;
    const secondary = await db.query.userEmails.findFirst({
        where: and(
            eq(schema.userEmails.userId, userId),
            eq(schema.userEmails.email, emailLower),
            eq(schema.userEmails.verified, true)
        ),
    });
    return !!secondary;
}

/**
 * Better-Auth instance.
 *
 * Anonymous code-based login is handled by a custom Elysia endpoint in
 * {@link anonymousAuthPlugin} rather than a Better-Auth plugin, because Better-Auth's
 * anonymous plugin works differently (auto-upgrades anonymous sessions) and
 * there is no built-in "credential" plugin in v1.4. The custom flow:
 *
 *  1. POST /auth/anonymous/generate — generates a 16-char base62 code,
 *     stores an Argon2id hash in Redis with a 5-min TTL, returns the plaintext.
 *
 *  2. POST /auth/anonymous/confirm — user types code back; we verify it
 *     against the Redis key, create a real account via Better-Auth's signUpEmail
 *     (with a dummy email + random password), and store codeHash on the user row.
 *
 *  3. POST /auth/anonymous/login — user enters their saved code; we scan
 *     anonymous accounts, verify with Argon2id, then call Better-Auth's
 *     signInEmail internally to produce a session.
 *
 * The database is the single source of truth between generate/confirm/login.
 */
async function safeGetOAuthState() {
    try {
        return await getOAuthState();
    } catch {
        return null;
    }
}

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema,
    }),

    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    const oauthState = (await safeGetOAuthState()) as { isolate?: boolean } | null;
                    if (oauthState?.isolate === true) {
                        user.email = `${crypto.randomUUID()}@anon.gacha-tracker.app`;
                        user.emailVerified = false;
                        return { data: user };
                    }
                    return { data: user };
                },
            },
        },
        account: {
            create: {
                before: async (account, ctx) => {
                    const typedCtx = ctx as unknown as BetterAuthHookContext;
                    const url = typedCtx?.request?.url || "";
                    const isCallback = url.includes("/callback/");
                    if (!isCallback) {
                        return { data: account };
                    }
                    const oauthState = (await safeGetOAuthState()) as {
                        isolate?: boolean;
                        reauth?: boolean;
                    } | null;
                    if (oauthState?.reauth === true) {
                        throw new APIError("UNAUTHORIZED", {
                            message: "Cannot link new accounts during re-authentication.",
                        });
                    }
                    if (oauthState?.isolate === true) {
                        return { data: account };
                    }
                    const session = await auth.api.getSession({
                        headers: typedCtx?.request?.headers ?? new Headers(),
                    });
                    if (session) {
                        return { data: account };
                    }
                    const existingUser = await db.query.user.findFirst({
                        where: eq(schema.user.id, account.userId),
                    });
                    if (existingUser) {
                        const [existingAccounts, hasVerifiedSecondary] = await Promise.all([
                            db.query.account.findFirst({
                                where: eq(schema.account.userId, existingUser.id),
                            }),
                            db.query.userEmails.findFirst({
                                where: and(
                                    eq(schema.userEmails.userId, existingUser.id),
                                    eq(schema.userEmails.verified, true)
                                ),
                            }),
                        ]);

                        const hasOtherMethods =
                            !!existingAccounts || !!hasVerifiedSecondary || !!existingUser.codeHash;

                        if (hasOtherMethods) {
                            const oauthEmail = (account as unknown as { email?: string }).email
                                ?.toLowerCase()
                                .trim();
                            let realEmail = existingUser.email;
                            if (oauthEmail) {
                                const secondaryMatch = await db.query.userEmails.findFirst({
                                    where: and(
                                        eq(schema.userEmails.email, oauthEmail),
                                        eq(schema.userEmails.verified, true)
                                    ),
                                });
                                if (secondaryMatch) {
                                    realEmail = oauthEmail;
                                }
                            }
                            const conflictToken = Buffer.from(
                                crypto.getRandomValues(new Uint8Array(32))
                            ).toString("hex");
                            const provider = url.includes("google")
                                ? "google"
                                : url.includes("discord")
                                  ? "discord"
                                  : "email";
                            const maskEmail = (emailStr: string): string => {
                                const [local, domain] = emailStr.split("@");
                                if (!local || !domain) return "u***@example.com";
                                if (local.length <= 2) return `${local[0]}***@${domain}`;
                                return `${local[0]}***${local[local.length - 1]}@${domain}`;
                            };
                            await redis.set(
                                RedisKeys.authConflict(conflictToken),
                                JSON.stringify({
                                    maskedEmail: maskEmail(realEmail),
                                    realEmail,
                                    userId: existingUser.id,
                                    provider,
                                    accountData: account,
                                }),
                                "EX",
                                300
                            );
                            throw new APIError("BAD_REQUEST", {
                                message: `account_conflict:${conflictToken}`,
                            });
                        }
                    }
                    return { data: account };
                },
            },
            delete: {
                before: async (account, ctx) => {
                    const typedCtx = ctx as unknown as BetterAuthHookContext;
                    const userId = account.userId;

                    const userRecord = await db.query.user.findFirst({
                        where: eq(schema.user.id, userId),
                    });

                    // Enforce primary email OTP verification for unlinking auth method (social provider)
                    if (userRecord && !userRecord.email.endsWith("@anon.gacha-tracker.app")) {
                        const verifiedKey = RedisKeys.sensitiveActionVerified(
                            userId,
                            "unlink-social",
                            account.providerId
                        );
                        const deleteKey = RedisKeys.sensitiveActionVerified(
                            userId,
                            "delete-account",
                            ""
                        );

                        const [isUnlinkVerified, isDeleteVerified] = await Promise.all([
                            redis.get(verifiedKey),
                            redis.get(deleteKey),
                        ]);

                        if (isUnlinkVerified !== "verified" && isDeleteVerified !== "verified") {
                            throw new APIError("UNAUTHORIZED", {
                                message:
                                    "OTP verification through primary email required to unlink provider.",
                            });
                        }

                        if (isUnlinkVerified === "verified") {
                            await redis.del(verifiedKey);
                        }
                    }

                    const currentSession = await auth.api.getSession({
                        headers: typedCtx?.request?.headers ?? new Headers(),
                    });

                    if (currentSession) {
                        // Delete all of this user's sessions EXCEPT the current active session
                        await db
                            .delete(schema.session)
                            .where(
                                and(
                                    eq(schema.session.userId, userId),
                                    ne(schema.session.id, currentSession.session.id)
                                )
                            );
                    } else {
                        // Fallback: revoke all sessions if we cannot identify the current one
                        await auth.api.revokeUserSessions({ body: { userId } });
                    }
                },
            },
        },
        session: {
            create: {
                before: async (session) => {
                    const oauthState = (await safeGetOAuthState()) as {
                        reauth?: boolean;
                        userId?: string;
                    } | null;
                    if (oauthState?.reauth === true) {
                        if (!oauthState.userId || oauthState.userId !== session.userId) {
                            throw new APIError("UNAUTHORIZED", {
                                message: "Re-authentication user mismatch.",
                            });
                        }
                        await redis.set(
                            RedisKeys.deleteAuth(session.userId),
                            "verified",
                            "EX",
                            300
                        );
                    }
                    return { data: session };
                },
            },
        },
    },

    onAPIError: {
        throw: true,
    },

    baseURL: config.BETTER_AUTH_URL,
    basePath: "/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.FRONTEND_URL],
    advanced: {
        useSecureCookies: config.isProduction,
        crossSubDomainCookies: {
            enabled: true,
        },
        cookies: {
            session_token: {
                attributes: {
                    sameSite: "lax",
                },
            },
        },
    },

    account: {
        accountLinking: {
            enabled: true,
            allowDifferentEmails: true,
            allowUnlinkingAll: true,
        },
    },

    user: {
        additionalFields: {
            isAnonymous: { type: "boolean", required: false, input: true },
            codeHash: { type: "string", required: false, input: true },
        },
    },

    socialProviders: socialProvidersConfig,

    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        admin(),
        emailOTP({
            sendVerificationOTP: async ({ email, otp, type }) => {
                await sendOtpEmail({ email, code: otp, type });
            },
            expiresIn: 300,
        }),
    ],
});

export type Auth = typeof auth;

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateSessionToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (b) => BASE62[b % 62]).join("");
}

export async function signSessionToken(rawToken: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(config.BETTER_AUTH_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawToken));
    const base64Sig = Buffer.from(sig).toString("base64");
    return `${rawToken}.${base64Sig}`;
}
