import { Elysia } from "elysia";
import { authPlugin } from "./modules/auth";
import { db } from "./db/client";
import { redis } from "./lib/redis";

const app = new Elysia()
  /**
   * Auth plugin: mounts Better-Auth at /api/auth/* and exposes the auth macro.
   * Also includes the anonymous auth endpoints at /api/auth/anonymous/*.
   */
  .use(authPlugin)

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
  .get("/health", async ({ set }) => {
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

    if (!isHealthy) {
      set.status = 503;
    }

    return {
      status: isHealthy ? "ok" : "degraded",
      db: dbStatus,
      redis: redisStatus,
      version: "0.1.0",
    };
  })

  .listen(3000);

console.log(
  `Gacha Tracker API is running at ${app.server?.hostname}:${app.server?.port}`,
);

export type App = typeof app;