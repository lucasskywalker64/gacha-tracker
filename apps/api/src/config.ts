import { z } from "zod";

const configSchema = z.object({
    DATABASE_URL: z.url(),
    DATABASE_AUTH_TOKEN: z.string(),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    DISCORD_CLIENT_ID: z.string(),
    DISCORD_CLIENT_SECRET: z.string(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
});

/**
 * Type-safe config. All env variables are validated at startup.
 * Direct access to Bun.env / process.env elsewhere in the codebase is
 * forbidden — always import from this module instead.
 */
export const config = configSchema.parse(Bun.env);

/** Import token TTL: 15 minutes */
export const IMPORT_TOKEN_TTL_SECONDS = 900;
/** Anonymous account pending code TTL: 15 minutes */
export const ANON_PENDING_TTL_SECONDS = 900;
