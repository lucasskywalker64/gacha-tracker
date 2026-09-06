import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq } from "drizzle-orm";
import { createClient } from "@libsql/client";
import * as schema from "../../../db/schema";
import { createTestTables } from "../db-setup.helper";
import { RedisKeys } from "../../../lib/redis-keys";
import type { NormalizedPull } from "@gacha-tracker/shared";

const redisStore = new Map<string, string>();
const mockRedis = {
    get: (key: string) => Promise.resolve(redisStore.get(key) || null),
    set: (key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve("OK");
    },
    del: (key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
    },
    ttl: () => Promise.resolve(0),
    ping: () => Promise.resolve("PONG"),
    publish: () => Promise.resolve(1),
};

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

describe("Pulls Import Sync & Caching", () => {
    let importApp: Elysia;
    let gamesApp: Elysia;
    let originalAuth: typeof import("../../auth/auth");

    afterAll(() => {
        if (originalAuth) {
            mock.module("../../auth/auth", () => originalAuth);
        }
    });

    beforeAll(async () => {
        mock.module("../../../lib/redis", () => ({ redis: mockRedis }));
        mock.module("../../../db/client", () => ({ db: testDb }));

        originalAuth = await import("../../auth/auth");

        mock.module("../../auth/auth", () => ({
            ...originalAuth,
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
                            user: { id: "opt-user-id", email: "opt@example.com" },
                            session: { token: "session_token" },
                        });
                    },
                    revokeSessions: () => Promise.resolve(),
                },
            },
        }));

        await createTestTables(sqlite);

        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
        await sqlite.execute(`DELETE FROM game`);
        await sqlite.execute(
            `INSERT INTO game (id, display_name, icon_url, is_active, config, created_at) VALUES ('genshin', 'Genshin Impact', 'http://icon.png', 1, '{}', 0)`
        );

        const { importRouter } = await import("../import");
        const { gamesRouter } = await import("../../games/routes");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        importApp = new Elysia().use(importRouter as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gamesApp = new Elysia().use(gamesRouter as any);
    });

    beforeEach(async () => {
        redisStore.clear();
        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
    });

    describe("POST /pulls/import/token Redis Caching & Selective Projection", () => {
        it("returns latestPullIds from Redis cache without querying database", async () => {
            const cacheKey = RedisKeys.userGameLatest("opt-user-id", "genshin", "UID_CACHED");
            redisStore.set(cacheKey, JSON.stringify({ "301": "PULL_REDIS_123" }));

            const resp = await importApp.fetch(
                new Request("http://localhost/pulls/import/token", {
                    method: "POST",
                    headers: {
                        Authorization: "Bearer session_token",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ gameId: "genshin", gameUid: "UID_CACHED" }),
                })
            );

            expect(resp.status).toBe(200);
            const body = await resp.json();
            expect(body.latestPullIds).toEqual({ "301": "PULL_REDIS_123" });
        });

        it("queries DB on Redis miss and populates Redis cache", async () => {
            await sqlite.execute(
                `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, latest_pull_ids, created_at)
                 VALUES ('ug-1', 'opt-user-id', 'genshin', 'UID_DB', 'Main', 1, '{"301":"PULL_DB_456"}', 1000)`
            );

            const cacheKey = RedisKeys.userGameLatest("opt-user-id", "genshin", "UID_DB");
            expect(redisStore.has(cacheKey)).toBe(false);

            const resp = await importApp.fetch(
                new Request("http://localhost/pulls/import/token", {
                    method: "POST",
                    headers: {
                        Authorization: "Bearer session_token",
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ gameId: "genshin", gameUid: "UID_DB" }),
                })
            );

            expect(resp.status).toBe(200);
            const body = await resp.json();
            expect(body.latestPullIds).toEqual({ "301": "PULL_DB_456" });

            // Verify Redis cache is primed
            expect(redisStore.get(cacheKey)).toBe('{"301":"PULL_DB_456"}');
        });
    });

    describe("executePullsImport Smart Diffing & Atomic Upsert", () => {
        it("creates first account as primary and saves latestPullIds to Redis", async () => {
            const { executePullsImport } = await import("../import");

            const pulls: NormalizedPull[] = [
                {
                    pullId: "1001",
                    gameUid: "UID_1",
                    bannerType: "301",
                    itemId: "ITEM1",
                    itemName: "Character A",
                    itemType: "character",
                    rarity: 5,
                    pulledAt: new Date("2026-01-01T00:00:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
            ];

            const result = await executePullsImport(
                "opt-user-id",
                "genshin",
                "UID_1",
                pulls,
                "First Account"
            );

            expect(result.imported).toBe(1);

            // Verify user_game is marked as primary
            const userGames = await testDb.query.userGame.findMany({
                where: (table, { eq }) => eq(table.userId, "opt-user-id"),
            });
            expect(userGames.length).toBe(1);
            expect(userGames[0].isPrimary).toBe(true);
            expect(userGames[0].nickname).toBe("First Account");

            // Verify Redis cache was set
            const cacheKey = RedisKeys.userGameLatest("opt-user-id", "genshin", "UID_1");
            expect(redisStore.has(cacheKey)).toBe(true);
        });

        it("creates second account as non-primary atomically", async () => {
            const { executePullsImport } = await import("../import");

            const pulls1: NormalizedPull[] = [
                {
                    pullId: "1001",
                    gameUid: "UID_1",
                    bannerType: "301",
                    itemId: "ITEM1",
                    itemName: "Character A",
                    itemType: "character",
                    rarity: 5,
                    pulledAt: new Date("2026-01-01T00:00:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
            ];
            await executePullsImport("opt-user-id", "genshin", "UID_1", pulls1, "Main");

            const pulls2: NormalizedPull[] = [
                {
                    pullId: "2001",
                    gameUid: "UID_2",
                    bannerType: "301",
                    itemId: "ITEM2",
                    itemName: "Character B",
                    itemType: "character",
                    rarity: 4,
                    pulledAt: new Date("2026-01-02T00:00:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
            ];
            await executePullsImport("opt-user-id", "genshin", "UID_2", pulls2, "Alt");

            const userGames = await testDb.query.userGame.findMany({
                where: (table, { eq }) => eq(table.userId, "opt-user-id"),
            });
            expect(userGames.length).toBe(2);

            const acc1 = userGames.find((u) => u.gameUid === "UID_1");
            const acc2 = userGames.find((u) => u.gameUid === "UID_2");

            expect(acc1?.isPrimary).toBe(true);
            expect(acc2?.isPrimary).toBe(false);
        });

        it("performs smart row diffing on identical re-import and reports 0 new pulls", async () => {
            const { executePullsImport } = await import("../import");

            const pulls: NormalizedPull[] = [
                {
                    pullId: "1001",
                    gameUid: "UID_1",
                    bannerType: "301",
                    itemId: "ITEM1",
                    itemName: "Character A",
                    itemType: "character",
                    rarity: 3,
                    pulledAt: new Date("2026-01-01T00:00:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "1002",
                    gameUid: "UID_1",
                    bannerType: "301",
                    itemId: "ITEM2",
                    itemName: "Character B",
                    itemType: "character",
                    rarity: 3,
                    pulledAt: new Date("2026-01-01T00:01:00Z"),
                    pityAtPull: 2,
                    wasGuaranteed: 0,
                },
            ];

            const firstResult = await executePullsImport("opt-user-id", "genshin", "UID_1", pulls);
            expect(firstResult.imported).toBe(2);

            // Re-import the exact same data
            const reimportResult = await executePullsImport(
                "opt-user-id",
                "genshin",
                "UID_1",
                pulls
            );
            expect(reimportResult.imported).toBe(0);
            expect(reimportResult.duplicates).toBe(2);
        });

        it("exercises incremental-window re-import with 5-star history and merges totals", async () => {
            const { executePullsImport } = await import("../import");

            const initialPulls: NormalizedPull[] = [
                {
                    pullId: "5001",
                    gameUid: "UID_INCR",
                    bannerType: "301",
                    itemId: "CHAR_5",
                    itemName: "Five Star Char",
                    itemType: "character",
                    rarity: 5,
                    pulledAt: new Date("2026-01-01T00:00:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "5002",
                    gameUid: "UID_INCR",
                    bannerType: "301",
                    itemId: "CHAR_4",
                    itemName: "Four Star Char",
                    itemType: "character",
                    rarity: 4,
                    pulledAt: new Date("2026-01-01T00:01:00Z"),
                    pityAtPull: 1,
                    wasGuaranteed: 0,
                },
            ];

            const firstResult = await executePullsImport(
                "opt-user-id",
                "genshin",
                "UID_INCR",
                initialPulls
            );
            expect(firstResult.imported).toBe(2);

            const newerPulls: NormalizedPull[] = [
                {
                    pullId: "5003",
                    gameUid: "UID_INCR",
                    bannerType: "301",
                    itemId: "WEAP_3",
                    itemName: "Three Star Weapon",
                    itemType: "weapon",
                    rarity: 3,
                    pulledAt: new Date("2026-01-01T00:02:00Z"),
                    pityAtPull: 2,
                    wasGuaranteed: 0,
                },
            ];

            const secondResult = await executePullsImport(
                "opt-user-id",
                "genshin",
                "UID_INCR",
                newerPulls
            );
            expect(secondResult.imported).toBe(1);

            const userGameRows = await testDb
                .select()
                .from(schema.userGame)
                .where(
                    and(
                        eq(schema.userGame.userId, "opt-user-id"),
                        eq(schema.userGame.gameId, "genshin"),
                        eq(schema.userGame.gameUid, "UID_INCR")
                    )
                );
            expect(userGameRows.length).toBe(1);
            const userGameRecord = userGameRows[0];
            expect(userGameRecord.statsTotalPulls).toBe(3);
            expect(userGameRecord.statsFiveStars).toBe(1);
            expect(userGameRecord.statsFourStars).toBe(1);
            expect(userGameRecord.statsCurrentPity?.["301"]).toBe(2);
            expect(userGameRecord.statsFiveStarHistory?.length).toBe(1);
            expect(userGameRecord.statsFiveStarHistory?.[0].pullId).toBe("5001");
        });
    });

    describe("resolvePrimaryOrEarliestAccount Single-Query Resolution", () => {
        it("resolves primary account when present", async () => {
            const { resolvePrimaryOrEarliestAccount } =
                await import("../../games/account-resolver");

            await sqlite.execute(
                `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
                 VALUES ('ug-alt', 'opt-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                        ('ug-main', 'opt-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
            );

            const resolved = await resolvePrimaryOrEarliestAccount("opt-user-id", "genshin");
            expect(resolved?.gameUid).toBe("UID_MAIN");
        });

        it("resolves earliest account when no primary account exists", async () => {
            const { resolvePrimaryOrEarliestAccount } =
                await import("../../games/account-resolver");

            await sqlite.execute(
                `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
                 VALUES ('ug-late', 'opt-user-id', 'genshin', 'UID_LATE', 'Late', 0, NULL, 2000),
                        ('ug-early', 'opt-user-id', 'genshin', 'UID_EARLY', 'Early', 0, NULL, 1000)`
            );

            const resolved = await resolvePrimaryOrEarliestAccount("opt-user-id", "genshin");
            expect(resolved?.gameUid).toBe("UID_EARLY");
        });
    });

    describe("GET /games Caching", () => {
        it("caches active games list in Redis", async () => {
            const resp = await gamesApp.fetch(new Request("http://localhost/games"));
            expect(resp.status).toBe(200);
            const games = await resp.json();
            expect(games.length).toBe(1);
            expect(games[0].id).toBe("genshin");

            const cacheKey = RedisKeys.gamesList();
            expect(redisStore.has(cacheKey)).toBe(true);
        });
    });
});
