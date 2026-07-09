import { z } from "zod";

const configSchema = z.object({
    DATABASE_URL: z.url(),
    DATABASE_AUTH_TOKEN: z.string(),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    FRONTEND_URL: z.url().default("http://localhost:5173"),
    DISCORD_CLIENT_ID: z.string(),
    DISCORD_CLIENT_SECRET: z.string(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    RESEND_API_KEY: z.string().startsWith("re_"),
    NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
    PORT: z.coerce.number().default(3000),
});

/**
 * Type-safe config. All env variables are validated at startup.
 * Direct access to Bun.env / process.env elsewhere in the codebase is
 * forbidden — always import from this module instead.
 */
const result = configSchema.safeParse(Bun.env);

if (!result.success) {
    if (Bun.env.NODE_ENV === "test") {
        console.warn("⚠️ Missing environment variables in test mode. Using empty config fallback.");
    } else {
        console.error("❌ Invalid environment variables:", result.error.format());
        process.exit(1);
    }
}

const parsedConfig = result.success
    ? result.data
    : {
          DATABASE_URL: "libsql://dummy-db-url.com",
          DATABASE_AUTH_TOKEN: "dummy-auth-token",
          REDIS_URL: "redis://localhost:6379",
          BETTER_AUTH_URL: "http://localhost:3000",
          BETTER_AUTH_SECRET: "dummy-secret-key-minimum-length-32-characters",
          FRONTEND_URL: "http://localhost:5173",
          DISCORD_CLIENT_ID: "discord-client-id",
          DISCORD_CLIENT_SECRET: "discord-client-secret",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          RESEND_API_KEY: "re_dummy",
          NODE_ENV: "test" as const,
          PORT: 3000,
      };

export const config = {
    ...parsedConfig,
    isProduction: parsedConfig.NODE_ENV === "production",
};

/** Import token TTL: 15 minutes */
export const IMPORT_TOKEN_TTL_SECONDS = 900;
/** Anonymous account pending code TTL: 15 minutes */
export const ANON_PENDING_TTL_SECONDS = 900;

/** Max concurrent file imports across all users. */
export const IMPORT_CONCURRENCY_LIMIT = 3;
/** Max number of imports waiting in queue (not yet processing). Caps queue RAM usage. */
export const IMPORT_QUEUE_MAX_DEPTH = 10;
/** Per-user cooldown between file imports, in seconds. */
export const IMPORT_USER_COOLDOWN_SECONDS = 60;
/** How long a completed/failed import result is kept in memory before being evicted, in ms. */
export const IMPORT_RESULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
