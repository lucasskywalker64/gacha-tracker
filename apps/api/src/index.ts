import { Elysia, t } from "elysia";
import { authPlugin } from "./modules/auth";
import { gamesRouter } from "./modules/games/routes";
import { userRouter } from "./modules/users/routes";
import { importRouter } from "./modules/pulls/import";
import { queryRouter } from "./modules/pulls/query";
import { eventsRouter } from "./modules/pulls/events";
import { statsRouter } from "./modules/stats";
import { db } from "./db/client";
import { redis } from "./lib/redis";
import { cors } from "@elysia/cors";
import { runMigrations } from "./db/migrate";
import { config } from "./config";
import { securityHeaders } from "./middleware/securityHeaders";
import { isAPIError } from "better-auth/api";

const allowedOrigins = ["https://gacha-tracker.app", "https://dev.gacha-tracker.app"];
try {
    allowedOrigins.push(new URL(config.FRONTEND_URL).origin);
} catch {
    console.warn(
        `[CORS] Failed to parse FRONTEND_URL "${config.FRONTEND_URL}". Falling back to local origin "http://localhost:5173".`
    );
    allowedOrigins.push("http://localhost:5173");
}

const app = new Elysia()
    .onError(({ error, set, request }) => {
        const err = error as { message?: string };
        if (isAPIError(err) && err.message?.startsWith("account_conflict:")) {
            const token = err.message.split(":")[1];
            const url = new URL(request.url);
            if (url.pathname.includes("/auth/callback/")) {
                set.redirect = `${config.FRONTEND_URL}/auth/callback?error=account_conflict&token=${token}`;
                return;
            }
        }
    })
    .mapResponse(async ({ responseValue, request }) => {
        const url = new URL(request.url);
        if (url.pathname.includes("/auth/callback/") && responseValue instanceof Response) {
            if (responseValue.status === 400 || responseValue.status === 500) {
                try {
                    const cloned = responseValue.clone();
                    const body = (await cloned.json()) as Record<string, unknown>;
                    const errorMsg = body.message || body.error;
                    if (typeof errorMsg === "string") {
                        if (errorMsg.startsWith("account_conflict:")) {
                            const token = errorMsg.split(":")[1];
                            return Response.redirect(
                                `${config.FRONTEND_URL}/auth/callback?error=account_conflict&token=${token}`,
                                302
                            );
                        }
                    }
                } catch {
                    // Ignore JSON parse errors
                }
            }
        }
    })
    .use(securityHeaders)
    .use(
        cors({
            origin: allowedOrigins,
            credentials: true,
        })
    )
    /**
     * Auth plugin: mounts Better-Auth at /api/auth/* and exposes the auth macro.
     * Also includes the anonymous auth endpoints at /api/auth/anonymous/*.
     */
    .use(authPlugin)
    .use(gamesRouter)
    .use(userRouter)
    .use(importRouter)
    .use(queryRouter)
    .use(eventsRouter)
    .use(statsRouter)

    /**
     * Health check.
     *
     * Returns the API version plus the live status of the two critical
     * dependencies — Turso (via a lightweight probe query) and Redis (via PING).
     * Useful for external Uptime monitors (e.g. UptimeRobot, Uptime Kuma) and the admin dashboard to
     * detect process death or disconnected dependencies.
     *
     * Phase 0 exit criterion: GET /health returns
     *   { status: 'ok', db: 'ok', redis: 'ok', version: '...' }
     */
    .get(
        "/health",
        async ({ status }) => {
            let dbStatus: "ok" | "error" = "error";
            let redisStatus: "ok" | "error" = "error";

            try {
                const { sql } = await import("drizzle-orm");
                await db.run(sql`SELECT 1`);
                dbStatus = "ok";
            } catch {
                console.error("[health] db check failed");
            }

            try {
                const pong = await redis.ping();
                if (pong === "PONG") redisStatus = "ok";
            } catch {
                console.error("[health] redis check failed");
            }

            const isHealthy = dbStatus === "ok" && redisStatus === "ok";

            if (isHealthy) {
                return status(200, {
                    status: "ok",
                    db: "ok",
                    redis: "ok",
                    version: "0.1.0",
                });
            } else {
                return status(503, {
                    status: "degraded",
                    db: dbStatus,
                    redis: redisStatus,
                    version: "0.1.0",
                });
            }
        },
        {
            response: {
                200: t.Object({
                    status: t.Literal("ok"),
                    db: t.Literal("ok"),
                    redis: t.Literal("ok"),
                    version: t.String(),
                }),
                503: t.Object({
                    status: t.Literal("degraded"),
                    db: t.Union([t.Literal("ok"), t.Literal("error")]),
                    redis: t.Union([t.Literal("ok"), t.Literal("error")]),
                    version: t.String(),
                }),
            },
        }
    );

await runMigrations();

app.listen(config.PORT);

console.log(
    `Gacha Tracker API is running at ${app.server?.hostname}:${app.server?.port} [Mode: ${config.isProduction ? "Production" : "Development"}]`
);

export type App = typeof app;
