import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { db } from "../../db/client";
import { config } from "../../config";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { anonymousAuthPlugin } from "./anonymous";

/**
 * Better-Auth instance.
 *
 * Anonymous code-based login is handled by a custom Elysia endpoint in
 * {@link anonymousAuthPlugin} rather than a Better-Auth plugin, because Better-Auth's
 * anonymous plugin works differently (auto-upgrades anonymous sessions) and
 * there is no built-in "credential" plugin in v1.4. The custom flow:
 *
 *  1. POST /api/auth/anonymous/generate — generates a 16-char base62 code,
 *     stores an Argon2id hash in Redis with a 5-min TTL, returns the plaintext.
 *
 *  2. POST /api/auth/anonymous/confirm — user types code back; we verify it
 *     against the Redis key, create a real account via Better-Auth's signUpEmail
 *     (with a dummy email + random password), and store codeHash on the user row.
 *
 *  3. POST /api/auth/anonymous/login — user enters their saved code; we scan
 *     anonymous accounts, verify with Argon2id, then call Better-Auth's
 *     signInEmail internally to produce a session.
 *
 * The database is the single source of truth between generate/confirm/login.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),

  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,

  user: {
    additionalFields: {
      /*
       * Custom columns (deletedAt, codeHash, isAnonymous, isAdmin) are defined
       * directly in the Drizzle schema as INTEGER/TEXT columns to enforce the
       * project-wide conventions. Declaring them here would cause Better-Auth
       * to override the column types.
       */
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

  plugins: [
    passkey(),
  ],
});

export type Auth = typeof auth;
