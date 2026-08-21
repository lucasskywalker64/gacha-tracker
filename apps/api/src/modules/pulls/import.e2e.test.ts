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
    pipeline: () => ({
        hset: () => {},
        expire: () => {},
        del: () => {},
        srem: () => {},
        sadd: () => {},
        set: () => {},
        exec: () => Promise.resolve([]),
    }),
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
        await sqlite.execute(`DELETE FROM import_log`);
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
                    "x-forwarded-for": "1.2.3.4",
                    "x-script-version": "1.5.0",
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

        // 4. Verify import_log entry
        const logs = await testDb.query.importLog.findMany();
        expect(logs.length).toBe(1);
        expect(logs[0].status).toBe("success");
        expect(logs[0].importMethod).toBe("script_api");
        expect(logs[0].totalFetched).toBe(1);
        expect(logs[0].newPulls).toBe(1);
        expect(logs[0].duplicates).toBe(0);
        expect(logs[0].sourceIp).toBe("1.2.3.4");
        expect(logs[0].scriptVersion).toBe("1.5.0");
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

        const logs = await testDb.query.importLog.findMany();
        expect(logs.length).toBe(2);
        const secondLog = logs.find((l) => l.newPulls === 0)!;
        expect(secondLog).toBeDefined();
        expect(secondLog.status).toBe("success");
        expect(secondLog.totalFetched).toBe(1);
        expect(secondLog.newPulls).toBe(0);
        expect(secondLog.duplicates).toBe(1);
    });

    it("should gracefully handle missing or malformed version metadata without crashing", async () => {
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
            gameUid: "UID999",
            scriptVersion: "   ", // whitespace only
            webAppVersion: null, // null value
            appVersion: 123, // number value coerced by safeString
            pulls: [
                {
                    pullId: "P2001",
                    bannerType: "11",
                    itemId: "C2",
                    itemName: "Kafka",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: "2024-02-01 12:00:00",
                },
            ],
        };

        const response = await app.fetch(
            new Request("http://localhost/pulls/import", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload),
            })
        );

        expect(response.status).toBe(200);

        const logs = await testDb.query.importLog.findMany({
            where: (log, { eq }) => eq(log.gameUid, "UID999"),
        });
        expect(logs.length).toBe(1);
        const targetLog = logs[0];
        expect(targetLog.status).toBe("success");
        expect(targetLog.scriptVersion).toBe(null);
        expect(targetLog.webAppVersion).toBe("123");
        expect(targetLog.fileVersion).toBe(null);
    });

    it("should record failed import_log on schema validation error", async () => {
        const tokenResp = await app.fetch(
            new Request("http://localhost/pulls/import/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gameId: "starrail" }),
            })
        );
        const { token } = (await tokenResp.json()) as { token: string };

        // Invalid payload missing pulls array
        const invalidPayload = {
            gameId: "starrail",
            gameUid: "UID_INVALID",
        };

        const response = await app.fetch(
            new Request("http://localhost/pulls/import", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(invalidPayload),
            })
        );

        expect(response.status).toBe(400);

        const logs = await testDb.query.importLog.findMany({
            where: (log, { eq }) => eq(log.status, "failed"),
        });
        expect(logs.length).toBeGreaterThanOrEqual(1);
        const failedLog = logs[logs.length - 1];
        expect(failedLog.status).toBe("failed");
        expect(failedLog.errorCode).toBe("SCHEMA_VALIDATION_ERROR");
        expect(failedLog.errorMessage).toContain("Invalid import payload");
    });
});
