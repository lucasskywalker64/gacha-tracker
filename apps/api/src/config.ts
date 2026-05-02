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

const parsedConfig = result.success ? result.data : ({} as z.infer<typeof configSchema>);

export const config = {
    ...parsedConfig,
    isProduction: parsedConfig.NODE_ENV === "production",
};

/** Import token TTL: 15 minutes */
export const IMPORT_TOKEN_TTL_SECONDS = 900;
/** Anonymous account pending code TTL: 15 minutes */
export const ANON_PENDING_TTL_SECONDS = 900;
