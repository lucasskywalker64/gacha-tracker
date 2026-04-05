import { Elysia, t } from "elysia";
import { authPlugin } from "./modules/auth";
import { gamesRouter } from "./modules/games/routes";
import { importRouter } from "./modules/pulls/import";
import { queryRouter } from "./modules/pulls/query";
import { statsRouter } from "./modules/stats";
import { db } from "./db/client";
import { redis } from "./lib/redis";

const app = new Elysia()
    /**
     * Auth plugin: mounts Better-Auth at /api/auth/* and exposes the auth macro.
     * Also includes the anonymous auth endpoints at /api/auth/anonymous/*.
     */
    .use(authPlugin)
    .use(gamesRouter)
    .use(importRouter)
    .use(queryRouter)
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
    )

    .listen(3000);

console.log(`Gacha Tracker API is running at ${app.server?.hostname}:${app.server?.port}`);

export type App = typeof app;
