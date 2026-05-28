import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, magicLink } from "better-auth/plugins";
import { db } from "../../db/client";
import { config } from "../../config";
import * as schema from "../../db/schema";
import { sendMagicLinkEmail } from "../../lib/email";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { anonymousAuthPlugin } from "./anonymous";
import { createHmac, timingSafeEqual } from "node:crypto";

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
export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema,
    }),

    baseURL: config.BETTER_AUTH_URL,
    basePath: "/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.FRONTEND_URL],
    advanced: {
        crossSubDomainCookies: {
            enabled: true,
        },
    },

    user: {
        additionalFields: {
            isAnonymous: { type: "boolean", required: false, input: true },
            codeHash: { type: "string", required: false, input: true },
        },
    },

    socialProviders: {
        discord: {
            clientId: config.DISCORD_CLIENT_ID,
            clientSecret: config.DISCORD_CLIENT_SECRET,
        },
        google: {
            clientId: config.GOOGLE_CLIENT_ID,
            clientSecret: config.GOOGLE_CLIENT_SECRET,
        },
    },

    emailAndPassword: {
        enabled: true,
    },
    plugins: [
        admin(),
        magicLink({
            sendMagicLink: sendMagicLinkEmail,
            expiresIn: 300, // 5 minutes
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
    const base64Sig = Buffer.from(sig).toString("base64url");
    return `${rawToken}.${base64Sig}`;
}
