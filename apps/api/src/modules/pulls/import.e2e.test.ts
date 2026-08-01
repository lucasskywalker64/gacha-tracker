import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../db/schema";
import { createTestTables } from "./db-setup.helper";

// --- Mocks ---
const redisStore = new Map<string, string>();
const mockRedis = {
    get: (key: string) => Promise.resolve(redisStore.get(key) || null),
    set: (key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve("OK");
    },
    publish: () => Promise.resolve(1),
    del: (key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
    },
    ttl: () => Promise.resolve(0),
    hset: () => Promise.resolve(1),
    hgetall: () => Promise.resolve({}),
    expire: () => Promise.resolve(1),
    ping: () => Promise.resolve("PONG"),
};

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

// --- Test Suite ---
describe("HSR Pull Import E2E", () => {
    let app: Elysia;
    let originalAuth: typeof import("../auth/auth");

    afterAll(() => {
        if (originalAuth) {
            mock.module("../auth/auth", () => originalAuth);
        }
    });

    beforeAll(async () => {
        console.log("[TEST] Setting up mocks and environment...");

        // Mock modules BEFORE dynamic import
        mock.module("../../lib/redis", () => ({ redis: mockRedis }));
        mock.module("../../db/client", () => ({ db: testDb }));

        originalAuth = await import("../auth/auth");

        mock.module("../auth/auth", () => ({
            ...originalAuth,
            signJWT: () => "test_signed_token",
            verifyJWT: () => ({ userId: "user_abc" }),
            generateSessionToken: () => "test_session_token",
            signSessionToken: async () => "test_signed_token",
            getUserAuthMethodsCount: mock(async () => ({
                primaryEmail: "test@example.com",
                secondaryEmails: [],
                socialAccounts: [],
                hasAnonymousCode: false,
                totalActiveCount: 1,
            })),
            auth: {
                ...originalAuth.auth,
                api: {
                    ...originalAuth.auth.api,
                    getSession: () =>
                        Promise.resolve({
                            user: { id: "test-user-id", email: "test@example.com" },
                            session: { token: "session_token" },
                        }),
                    revokeSessions: () => Promise.resolve(),
                },
            },
        }));

        // Setup Database (Matching Drizzle schema)
        console.log("[TEST] Creating tables...");
        await createTestTables(sqlite);

        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
        await sqlite.execute(`DELETE FROM game`);
        await sqlite.execute(
            `INSERT INTO game (id, display_name, is_active, config, created_at) VALUES ('starrail', 'Honkai: Star Rail', 1, '{}', 0)`
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
        const dbPulls = await testDb.query.pull.findMany();
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

        const allPulls = await testDb.query.pull.findMany();
        const pullCount = allPulls.filter((p) => p.pullId === "P1001").length;
        expect(pullCount).toBe(1); // Should still be 1
    });
});
