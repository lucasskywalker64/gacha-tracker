import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../db/schema";
import { createTestTables } from "./db-setup.helper";
import LZString from "lz-string";
import { _reset as resetQueue } from "../../lib/importQueue";
import { createMockPaimonXlsx } from "./parsers/paimon-moe/paimon-moe-mock";

// --- Mocks ---
const redisStore = new Map<string, string>();
const mockRedis = {
    get: (key: string) => Promise.resolve(redisStore.get(key) || null),
    set: (
        key: string,
        value: string,
        _mode?: string,
        _duration?: number | string,
        flag?: string
    ) => {
        if (flag === "NX" || _duration === "NX" || _mode === "NX") {
            if (redisStore.has(key)) {
                return Promise.resolve(null);
            }
        }
        redisStore.set(key, value);
        return Promise.resolve("OK");
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    publish: (channel: string, message: string) => Promise.resolve(1),
    del: (key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
    },
    ttl: (key: string) => Promise.resolve(redisStore.has(key) ? 60 : -2),
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
        await sqlite.execute(
            `INSERT INTO game (id, display_name, is_active, config, created_at) VALUES ('wuwa', 'Wuthering Waves', 1, '{}', 0)`
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

    beforeEach(() => {
        redisStore.clear();
        resetQueue();
    });

    async function pollStatusUntilFinished(requestId: string): Promise<{
        status: string;
        position: number | null;
        waitedSeconds: number;
        result?: {
            success: boolean;
            summary: Array<{
                gameId: string;
                gameUid: string;
                imported: number;
                message: string;
                success: boolean;
            }>;
        };
        error?: string;
    }> {
        let attempts = 0;
        while (attempts < 50) {
            const resp = await app.fetch(
                new Request(`http://localhost/pulls/import/status/${requestId}`, {
                    method: "GET",
                    headers: {
                        Authorization: "Bearer session_token",
                    },
                })
            );
            expect(resp.status).toBe(200);
            const body = (await resp.json()) as Awaited<ReturnType<typeof pollStatusUntilFinished>>;
            if (body.status === "done" || body.status === "failed") {
                return body;
            }
            await new Promise((r) => setTimeout(r, 10));
            attempts++;
        }
        throw new Error("Polling status timed out in test");
    }

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
        expect(body.formats.find((f: { id: string }) => f.id === "gacha-tracker")).toBeDefined();
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
        formData.append("format", "gacha-tracker");
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        // Poll status until done
        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("done");
        expect(pollResult.result!.success).toBe(true);
        expect(pollResult.result!.summary.length).toBe(1);
        expect(pollResult.result!.summary[0].gameId).toBe("starrail");
        expect(pollResult.result!.summary[0].imported).toBe(1); // 1 new, 1 duplicate skipped

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
        formData.append("format", "gacha-tracker");
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
        formData.append("format", "gacha-tracker");
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("failed");
        expect(pollResult.error).toContain("Invalid JSON structure");
    });

    it("should return 422 for a file exceeding the size limit", async () => {
        // Create a blob larger than 5MB (e.g. 5.1MB of spaces)
        const largeString = " ".repeat(5.1 * 1024 * 1024);
        const formData = new FormData();
        formData.append("format", "gacha-tracker");
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
        formData.append("format", "gacha-tracker");
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("failed");
        expect(pollResult.error).toContain("Invalid backup data structure");
        expect(pollResult.error).toContain("[games.0.gameId]");
    });

    it("should import pulls from a WuWaTracker JSON export file", async () => {
        const wuwaExport = {
            playerId: "123456789",
            pulls: [
                {
                    cardPoolType: 1,
                    resourceId: 21020013,
                    qualityLevel: 3,
                    name: "Sword of Night",
                    time: "2026-02-05T14:03:09+00:00",
                    group: 2,
                },
                {
                    cardPoolType: 1,
                    resourceId: 1205,
                    qualityLevel: 5,
                    name: "Changli",
                    time: "2026-02-05T14:03:09+00:00",
                    group: 1,
                },
            ],
        };

        const formData = new FormData();
        formData.append("format", "wuwa-tracker");
        formData.append(
            "file",
            new Blob([JSON.stringify(wuwaExport)], { type: "application/json" }),
            "wuwa_export.json"
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("done");
        expect(pollResult.result!.success).toBe(true);
        expect(pollResult.result!.summary.length).toBe(1);
        expect(pollResult.result!.summary[0].gameId).toBe("wuwa");
        expect(pollResult.result!.summary[0].imported).toBe(2);

        // Verify pulls are in the database and sorted/attributed correctly
        const pullsInDb = await testDb.query.pull.findMany({
            where: (p, { eq }) => eq(p.gameId, "wuwa"),
            orderBy: (p, { asc }) => [asc(p.pulledAt), asc(p.pullId)],
        });

        expect(pullsInDb.length).toBe(2);

        // Changli (group 1) should be first
        expect(pullsInDb[0].itemName).toBe("Changli");
        expect(pullsInDb[0].itemType).toBe("Resonator");
        expect(pullsInDb[0].pityAtPull).toBe(1); // First pull pity is 1
        expect(pullsInDb[0].pullId).toBe("123456789_1_2026-02-05-14-03-09_0");

        // Sword of Night (group 2) should be second
        expect(pullsInDb[1].itemName).toBe("Sword of Night");
        expect(pullsInDb[1].itemType).toBe("Weapon");
        expect(pullsInDb[1].pityAtPull).toBe(1); // reset after 5* pull (Changli)
        expect(pullsInDb[1].pullId).toBe("123456789_1_2026-02-05-14-03-09_1");
    });

    it("should import pulls from a Star Rail Station CSV export file", async () => {
        const csvContent = [
            "uid,id,rarity,time,banner,type,manual",
            "1682532600000704444,1009,4,2023-04-26T18:14:12.000Z,1001,1,false",
        ].join("\n");

        const formData = new FormData();
        formData.append("format", "starrail-station");
        formData.append(
            "file",
            new Blob([csvContent], { type: "text/csv" }),
            "starrailstation-warp-data.csv"
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("done");
        expect(pollResult.result!.success).toBe(true);
        expect(pollResult.result!.summary.length).toBe(1);
        expect(pollResult.result!.summary[0].gameId).toBe("starrail");
        expect(pollResult.result!.summary[0].imported).toBe(1);

        // Verify pulls are in the database
        const pullsInDb = await testDb.query.pull.findMany({
            where: (p, { eq }) => eq(p.gameId, "starrail"),
        });
        // Seed was '1001' Seele, Test 3 added '1002' Natasha. We now added '1682532600000704444' Asta.
        expect(pullsInDb.length).toBe(3);
        const astaPull = pullsInDb.find((p) => p.pullId === "1682532600000704444");
        expect(astaPull).toBeDefined();
        expect(astaPull!.itemName).toBe("Asta");
        expect(astaPull!.itemType).toBe("Character");
    });

    it("should import pulls from a Star Rail Station DAT export file", async () => {
        const mockBackup = {
            data: {
                stores: {
                    "1_warp-v2": {
                        items_12: [
                            {
                                uid: "1772565000000906744",
                                itemId: 23002, // Something Irreplaceable
                                rarity: 5,
                                timestamp: 1772567454000,
                                gachaType: 22, // LC rerun -> mapped to 12
                            },
                        ],
                    },
                },
            },
        };

        const compressed = LZString.compressToUTF16(JSON.stringify(mockBackup));
        const datBuffer = Buffer.concat([
            Buffer.from("srs", "utf-8"),
            Buffer.from(compressed, "utf-8"),
        ]);

        const formData = new FormData();
        formData.append("format", "starrail-station");
        formData.append(
            "file",
            new Blob([datBuffer], { type: "application/octet-stream" }),
            "starrailstation-backup.dat"
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("done");
        expect(pollResult.result!.success).toBe(true);
        expect(pollResult.result!.summary.length).toBe(1);
        expect(pollResult.result!.summary[0].gameId).toBe("starrail");
        expect(pollResult.result!.summary[0].imported).toBe(1);

        // Verify pulls are in the database
        const pullsInDb = await testDb.query.pull.findMany({
            where: (p, { eq }) => eq(p.gameId, "starrail"),
        });
        const lcPull = pullsInDb.find((p) => p.pullId === "1772565000000906744");
        expect(lcPull).toBeDefined();
        expect(lcPull!.itemName).toBe("Something Irreplaceable");
        expect(lcPull!.itemType).toBe("Light Cone");
        expect(lcPull!.bannerType).toBe("12"); // Mapped to 12
    });

    it("should import pulls from a paimon-moe XLSX export file when gameUid is provided", async () => {
        const fileBuffer = createMockPaimonXlsx({
            "Character Event": [
                ["Character", "Diona", "2022-02-19 16:22:15", 4],
                ["Character", "Sangonomiya Kokomi", "2022-02-19 16:22:20", 5],
            ],
            "Weapon Event": [["Weapon", "Dull Blade", "2022-02-19 16:22:25", 3]],
            Standard: [["Character", "Diluc", "2022-02-19 16:22:30", 5]],
            "Beginners' Wish": [["Character", "Noelle", "2022-02-19 16:22:35", 4]],
        });

        const formData = new FormData();
        formData.append("format", "paimon-moe");
        formData.append("gameUid", "700000001");
        formData.append(
            "file",
            new Blob([new Uint8Array(fileBuffer)], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }),
            "paimonmoe_wish_history.xlsx"
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

        expect(resp.status).toBe(202);
        const postBody = await resp.json();
        expect(postBody.requestId).toBeDefined();

        const pollResult = await pollStatusUntilFinished(postBody.requestId);
        expect(pollResult.status).toBe("done");
        expect(pollResult.result!.success).toBe(true);
        expect(pollResult.result!.summary.length).toBe(1);
        expect(pollResult.result!.summary[0].gameId).toBe("genshin");
        expect(pollResult.result!.summary[0].gameUid).toBe("700000001");
        expect(pollResult.result!.summary[0].imported).toBe(5);

        // Verify pulls are in the database under gameId "genshin"
        const pullsInDb = await testDb.query.pull.findMany({
            where: (p, { eq }) => eq(p.gameId, "genshin"),
        });
        expect(pullsInDb.length).toBe(5);
        const firstPull = pullsInDb[0];
        expect(firstPull.gameUid).toBe("700000001");
        expect(firstPull.gameId).toBe("genshin");
    });

    describe("Import Queue and Concurrency Limits", () => {
        it("returns 429 when trying to upload twice during cooldown period", async () => {
            const formData = new FormData();
            formData.append("format", "gacha-tracker");
            formData.append("file", new Blob(["{}"], { type: "application/json" }), "backup.json");

            // Make first request
            const resp1 = await app.fetch(
                new Request("http://localhost/pulls/import/file", {
                    method: "POST",
                    headers: { Authorization: "Bearer session_token" },
                    body: formData,
                })
            );
            expect(resp1.status).toBe(202);

            // Make second request immediately
            const resp2 = await app.fetch(
                new Request("http://localhost/pulls/import/file", {
                    method: "POST",
                    headers: { Authorization: "Bearer session_token" },
                    body: formData,
                })
            );
            expect(resp2.status).toBe(429);
            const body = await resp2.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("You can only import once per minute");
            expect(body.retryAfter).toBe(60);
        });

        it("returns 503 when the queue depth limit is exceeded", async () => {
            const { registerWorker } = await import("../../lib/importQueue");
            // Set a worker that never resolves so entries stay in processing/queued states
            registerWorker(() => new Promise(() => {}));

            const formData = new FormData();
            formData.append("format", "gacha-tracker");
            formData.append("file", new Blob(["{}"], { type: "application/json" }), "backup.json");

            // Fill 3 processing slots + 10 queue slots = 13 successful POSTs
            const { RedisKeys } = await import("../../lib/redis-keys");
            const cooldownKey = RedisKeys.importCooldown("test-user-id");

            for (let i = 0; i < 13; i++) {
                redisStore.delete(cooldownKey);
                const resp = await app.fetch(
                    new Request("http://localhost/pulls/import/file", {
                        method: "POST",
                        headers: { Authorization: "Bearer session_token" },
                        body: formData,
                    })
                );
                expect(resp.status).toBe(202);
            }

            // The 14th request should get 503
            redisStore.delete(cooldownKey);
            const resp = await app.fetch(
                new Request("http://localhost/pulls/import/file", {
                    method: "POST",
                    headers: { Authorization: "Bearer session_token" },
                    body: formData,
                })
            );
            expect(resp.status).toBe(503);
            const body = await resp.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("queue is currently full");
        });

        it("returns 403 when trying to access status of another user's request", async () => {
            const { enqueue: directEnqueue } = await import("../../lib/importQueue");
            const entry = directEnqueue({
                requestId: "another-user-request-id",
                userId: "different-user-id",
                buffer: Buffer.alloc(0),
                format: "gacha-tracker",
            });

            const resp = await app.fetch(
                new Request(`http://localhost/pulls/import/status/${entry.requestId}`, {
                    method: "GET",
                    headers: { Authorization: "Bearer session_token" }, // authenticated as test-user-id
                })
            );
            expect(resp.status).toBe(403);
            const body = await resp.json();
            expect(body.success).toBe(false);
            expect(body.error).toContain("Access denied");
        });

        it("cancels a queued request successfully and returns 200, then fails when trying to cancel an already processing request with 409", async () => {
            const { registerWorker } = await import("../../lib/importQueue");
            // Set a worker that never resolves
            registerWorker(() => new Promise(() => {}));

            const formData = new FormData();
            formData.append("format", "gacha-tracker");
            formData.append("file", new Blob(["{}"], { type: "application/json" }), "backup.json");

            const { RedisKeys } = await import("../../lib/redis-keys");
            const cooldownKey = RedisKeys.importCooldown("test-user-id");

            // Enqueue 4 requests: 3 go to processing, 4th stays in queue
            const requestIds: string[] = [];
            for (let i = 0; i < 4; i++) {
                redisStore.delete(cooldownKey);
                const resp = await app.fetch(
                    new Request("http://localhost/pulls/import/file", {
                        method: "POST",
                        headers: { Authorization: "Bearer session_token" },
                        body: formData,
                    })
                );
                expect(resp.status).toBe(202);
                const body = await resp.json();
                requestIds.push(body.requestId);
            }

            // requestIds[3] is queued (position 1)
            // requestIds[0] is processing

            // 1. Try to cancel queued request requestIds[3]
            const cancelResp = await app.fetch(
                new Request(`http://localhost/pulls/import/queue/${requestIds[3]}`, {
                    method: "DELETE",
                    headers: { Authorization: "Bearer session_token" },
                })
            );
            expect(cancelResp.status).toBe(200);
            const cancelBody = await cancelResp.json();
            expect(cancelBody.success).toBe(true);

            // Check status of cancelled request
            const statusResp = await app.fetch(
                new Request(`http://localhost/pulls/import/status/${requestIds[3]}`, {
                    method: "GET",
                    headers: { Authorization: "Bearer session_token" },
                })
            );
            const statusBody = await statusResp.json();
            expect(statusBody.status).toBe("cancelled");

            // 2. Try to cancel processing request requestIds[0]
            const cancelProcessingResp = await app.fetch(
                new Request(`http://localhost/pulls/import/queue/${requestIds[0]}`, {
                    method: "DELETE",
                    headers: { Authorization: "Bearer session_token" },
                })
            );
            expect(cancelProcessingResp.status).toBe(409);
            const cancelProcessingBody = await cancelProcessingResp.json();
            expect(cancelProcessingBody.success).toBe(false);
            expect(cancelProcessingBody.error).toContain("cannot be cancelled");
        });
    });
});
