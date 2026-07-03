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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    set: (key: string, value: string, _mode?: string, _duration?: number) => {
        redisStore.set(key, value);
        return Promise.resolve("OK");
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    publish: (channel: string, message: string) => Promise.resolve(1),
    del: (key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
    },
    ping: () => Promise.resolve("PONG"),
};

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

describe("Pull File Import/Export E2E", () => {
    let app: Elysia;
    let originalAuth: typeof import("../auth/auth");

    afterAll(() => {
        if (originalAuth) {
            mock.module("../auth/auth", () => originalAuth);
        }
    });

    beforeAll(async () => {
        console.log("[TEST] Setting up mocks and environment for File Import/Export...");

        // Mock modules BEFORE dynamic import
        mock.module("../../lib/redis", () => ({ redis: mockRedis }));
        mock.module("../../db/client", () => ({ db: testDb }));

        originalAuth = await import("../auth/auth");

        mock.module("../auth/auth", () => ({
            ...originalAuth,
            signJWT: () => "test_signed_token",
            verifyJWT: () => ({ userId: "test-user-id" }),
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
                    getSession: ({ headers }: { headers: Headers | Record<string, string> }) => {
                        const authHeader =
                            headers instanceof Headers
                                ? headers.get("authorization")
                                : headers.authorization || headers.Authorization;
                        if (!authHeader || authHeader !== "Bearer session_token") {
                            return Promise.resolve(null);
                        }
                        return Promise.resolve({
                            user: { id: "test-user-id", email: "test@example.com" },
                            session: { token: "session_token" },
                        });
                    },
                    revokeSessions: () => Promise.resolve(),
                },
            },
        }));

        // Setup Database (Matching Drizzle schema)
        await createTestTables(sqlite);

        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
        await sqlite.execute(`DELETE FROM game`);
        await sqlite.execute(
            `INSERT INTO game (id, display_name, is_active, config, created_at) VALUES ('starrail', 'Honkai: Star Rail', 1, '{}', 0)`
        );

        // Seed some initial pulls
        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('P1', 'test-user-id', 'starrail', 'UID_ABC', '1001', '11', 'ITEM1', 'Seele', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        // Dynamic import the router so it uses the mocks
        const { importRouter } = await import("./import");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app = new Elysia().use(importRouter as any);
        console.log("[TEST] Setup complete.");
    });

    it("should export user pulls in native JSON format", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/pulls/export", {
                method: "GET",
                headers: {
                    Authorization: "Bearer session_token",
                },
            })
        );

        expect(resp.status).toBe(200);
        expect(resp.headers.get("content-type")).toBe("application/json");
        expect(resp.headers.get("content-disposition")).toContain("attachment; filename=");

        const body = await resp.json();
        expect(body.version).toBe(1);
        expect(body.games.length).toBe(1);
        expect(body.games[0].gameId).toBe("starrail");
        expect(body.games[0].gameUid).toBe("UID_ABC");
        expect(body.games[0].pulls.length).toBe(1);
        expect(body.games[0].pulls[0].pullId).toBe("1001");
        expect(body.games[0].pulls[0].itemName).toBe("Seele");
    });

    it("should return the list of supported import formats", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/formats", {
                method: "GET",
                headers: {
                    Authorization: "Bearer session_token",
                },
            })
        );

        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.formats).toBeDefined();
        expect(body.formats.length).toBeGreaterThanOrEqual(1);
        expect(
            body.formats.find((f: { id: string }) => f.id === "gacha-tracker-json")
        ).toBeDefined();
    });

    it("should import pulls from a native JSON backup file", async () => {
        // Create an export payload with 1 new pull and 1 duplicate pull
        const backupJson = {
            version: 1,
            exportedAt: new Date().toISOString(),
            games: [
                {
                    gameId: "starrail",
                    gameUid: "UID_ABC",
                    pulls: [
                        {
                            pullId: "1001", // Duplicate
                            bannerType: "11",
                            itemId: "ITEM1",
                            itemName: "Seele",
                            itemType: "character",
                            rarity: 5,
                            pulledAt: "2024-01-01T00:00:00.000Z",
                            pityAtPull: 1,
                            wasGuaranteed: 0,
                        },
                        {
                            pullId: "1002", // New Pull
                            bannerType: "11",
                            itemId: "ITEM2",
                            itemName: "Natasha",
                            itemType: "character",
                            rarity: 4,
                            pulledAt: "2024-01-01T00:01:00.000Z",
                            pityAtPull: 1,
                            wasGuaranteed: 0,
                        },
                    ],
                },
            ],
        };

        const formData = new FormData();
        formData.append("format", "gacha-tracker-json");
        formData.append(
            "file",
            new Blob([JSON.stringify(backupJson)], { type: "application/json" }),
            "backup.json"
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                headers: {
                    Authorization: "Bearer session_token",
                },
                body: formData,
            })
        );

        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.success).toBe(true);
        expect(body.summary.length).toBe(1);
        expect(body.summary[0].gameId).toBe("starrail");
        expect(body.summary[0].imported).toBe(1); // 1 new, 1 duplicate skipped

        // Verify pull is in database
        const pullsInDb = await testDb.query.pull.findMany();
        expect(pullsInDb.length).toBe(2);
        expect(pullsInDb.map((p) => p.pullId)).toContain("1002");
    });

    it("should return 401 Unauthorized for unauthenticated access on export", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/pulls/export", {
                method: "GET",
            })
        );
        expect(resp.status).toBe(401);
    });

    it("should return 401 Unauthorized for unauthenticated access on file import", async () => {
        const formData = new FormData();
        formData.append("format", "gacha-tracker-json");
        formData.append("file", new Blob(["{}"], { type: "application/json" }), "backup.json");

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                body: formData,
            })
        );
        expect(resp.status).toBe(401);
    });

    it("should return 422 for an unknown format during file import", async () => {
        const formData = new FormData();
        formData.append("format", "unknown-format-id");
        formData.append(
            "file",
            new Blob([JSON.stringify({ version: 1, games: [] })], { type: "application/json" }),
            "backup.json"
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                headers: {
                    Authorization: "Bearer session_token",
                },
                body: formData,
            })
        );

        expect(resp.status).toBe(422);
        const body = await resp.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("Unsupported import format");
    });

    it("should return 422 for a malformed JSON file during import", async () => {
        const formData = new FormData();
        formData.append("format", "gacha-tracker-json");
        formData.append(
            "file",
            new Blob(["this is not json"], { type: "application/json" }),
            "backup.json"
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                headers: {
                    Authorization: "Bearer session_token",
                },
                body: formData,
            })
        );

        expect(resp.status).toBe(422);
        const body = await resp.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("Invalid JSON structure");
    });

    it("should return 422 for a file exceeding the size limit", async () => {
        // Create a blob larger than 2MB (e.g. 2.1MB of spaces)
        const largeString = " ".repeat(2.1 * 1024 * 1024);
        const formData = new FormData();
        formData.append("format", "gacha-tracker-json");
        formData.append(
            "file",
            new Blob([largeString], { type: "application/json" }),
            "backup.json"
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                headers: {
                    Authorization: "Bearer session_token",
                },
                body: formData,
            })
        );

        expect(resp.status).toBe(422);
    });

    it("should return 422 with a clean error message for Zod validation failures", async () => {
        const invalidBackup = {
            version: 1,
            games: [
                {
                    gameId: "invalid-game-id", // invalid option
                    gameUid: "12345",
                    pulls: [],
                },
            ],
        };

        const formData = new FormData();
        formData.append("format", "gacha-tracker-json");
        formData.append(
            "file",
            new Blob([JSON.stringify(invalidBackup)], { type: "application/json" }),
            "backup.json"
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls/import/file", {
                method: "POST",
                headers: {
                    Authorization: "Bearer session_token",
                },
                body: formData,
            })
        );

        expect(resp.status).toBe(422);
        const body = await resp.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain("Invalid backup data structure");
        expect(body.error).toContain("[games.0.gameId]");
    });
});
