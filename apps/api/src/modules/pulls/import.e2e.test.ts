import { describe, it, expect, beforeAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../db/schema";

// --- Mocks ---
const redisStore = new Map<string, string>();
const mockRedis = {
    get: (key: string) => Promise.resolve(redisStore.get(key) || null),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    set: (key: string, value: string, _mode?: string, _duration?: number) => {
        redisStore.set(key, value);
        return Promise.resolve("OK");
    },
    ping: () => Promise.resolve("PONG"),
};

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

const mockAuthPlugin = new Elysia({ name: "auth" })
    .derive(() => ({
        user: { id: "test-user-id", email: "test@example.com" },
    }))
    .macro({
        auth: () => ({
            resolve: () => ({ user: { id: "test-user-id" } }),
        }),
    });

// --- Test Suite ---
describe("HSR Pull Import E2E", () => {
    let app: Elysia;

    beforeAll(async () => {
        console.log("[TEST] Setting up mocks and environment...");

        // Mock modules BEFORE dynamic import
        mock.module("../../lib/redis", () => ({ redis: mockRedis }));
        mock.module("../../db/client", () => ({ db: testDb }));
        mock.module("../auth", () => ({ authPlugin: mockAuthPlugin }));

        // Setup Database (Matching Drizzle schema)
        console.log("[TEST] Creating tables...");
        await sqlite.execute(
            `CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified INTEGER, image TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, code_hash TEXT, is_anonymous INTEGER, is_admin INTEGER)`
        );
        await sqlite.execute(
            `CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, display_name TEXT, icon_url TEXT, is_active INTEGER, config TEXT, created_at INTEGER)`
        );
        await sqlite.execute(
            `CREATE TABLE IF NOT EXISTS user_games (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, last_import INTEGER, latest_pull_ids TEXT, created_at INTEGER)`
        );
        await sqlite.execute(
            `CREATE TABLE IF NOT EXISTS pulls (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, game_uid TEXT, pull_id TEXT, banner_type TEXT, banner_id TEXT, item_id TEXT, item_name TEXT, item_type TEXT, rarity INTEGER, pulled_at INTEGER, pity_at_pull INTEGER, was_guaranteed INTEGER, pity_version INTEGER, extra TEXT, created_at INTEGER)`
        );

        // Add required indexes for ON CONFLICT
        await sqlite.execute(
            `CREATE UNIQUE INDEX IF NOT EXISTS user_games_user_game_idx ON user_games (user_id, game_id)`
        );
        await sqlite.execute(
            `CREATE UNIQUE INDEX IF NOT EXISTS pulls_dedup_idx ON pulls (user_id, game_id, pull_id)`
        );

        await sqlite.execute(
            `INSERT INTO games (id, display_name, is_active, config, created_at) VALUES ('starrail', 'Honkai: Star Rail', 1, '{}', 0)`
        );
        console.log("[TEST] Tables created and game seeded.");

        // Dynamic import the router so it uses the mocks
        const { importRouter } = await import("./import");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app = new Elysia().use(importRouter as any);
        console.log("[TEST] Setup complete.");
    });

    it("should generate an import token and accept a payload", async () => {
        // 1. Get token
        const reqToken = new Request("http://localhost/pulls/import/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gameId: "starrail" }),
        });
        const tokenResp = await app.fetch(reqToken);

        if (tokenResp.status !== 200) {
            console.error("Token generation failed Status:", tokenResp.status);
            console.error("Token generation failed Text:", await tokenResp.text());
            expect(tokenResp.status).toBe(200);
            return;
        }

        const data = (await tokenResp.json()) as { token: string };
        const token = data.token;
        expect(token).toBeDefined();

        // 2. Import Data
        const payload = {
            gameId: "starrail",
            gameUid: "UID123",
            pulls: [
                {
                    pullId: "P1001",
                    bannerType: "11",
                    itemId: "C1",
                    itemName: "Seele",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: "2024-01-01 12:00:00",
                },
            ],
        };

        const importResp = await app.fetch(
            new Request("http://localhost/pulls/import", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            })
        );

        if (importResp.status !== 200) {
            console.error("Import failed Status:", importResp.status);
            console.error("Import failed Text:", await importResp.text());
            expect(importResp.status).toBe(200);
            return;
        }

        const result = (await importResp.json()) as { success: boolean };
        expect(result.success).toBe(true);

        // 3. Verify Database
        const dbPulls = await testDb.query.pulls.findMany();
        expect(dbPulls.length).toBe(1);
        expect(dbPulls[0].itemName).toBe("Seele");
        expect(dbPulls[0].pityAtPull).toBe(1);
    });

    it("should be idempotent when re-importing the same data", async () => {
        const tokenResp = await app.fetch(
            new Request("http://localhost/pulls/import/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameId: "starrail" }),
            })
        );
        const { token } = (await tokenResp.json()) as { token: string };

        const payload = {
            gameId: "starrail",
            gameUid: "UID123",
            pulls: [
                {
                    pullId: "P1001",
                    bannerType: "11",
                    itemId: "C1",
                    itemName: "Seele",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: "2024-01-01 12:00:00",
                },
            ],
        };

        // Second import (same payload)
        const response = await app.fetch(
            new Request("http://localhost/pulls/import", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            })
        );

        const result = (await response.json()) as { success: boolean };
        expect(result.success).toBe(true);

        const allPulls = await testDb.query.pulls.findMany();
        const pullCount = allPulls.filter((p) => p.pullId === "P1001").length;
        expect(pullCount).toBe(1); // Should still be 1
    });
});
