import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../../db/schema";
import { createTestTables } from "../../pulls/db-setup.helper";

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
};

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

describe("Stats Query API (Multi-Account)", () => {
    let app: Elysia;
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
                            user: { id: "test-user-id", email: "test@example.com" },
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
            `INSERT INTO game (id, display_name, is_active, config, created_at) VALUES ('genshin', 'Genshin Impact', 1, '{}', 0)`
        );

        const { statsRouter } = await import("../index");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app = new Elysia().use(statsRouter as any);
    });

    beforeEach(async () => {
        redisStore.clear();
        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
    });

    it("calculates stats for primary account by default and scopes cache key", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item 1', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-3', 'test-user-id', 'genshin', 'UID_MAIN', '202', '301', 'ITEM3', 'Main Item 2', 'character', 4, 1704067300000, 2, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(2);
        expect(body.fiveStars).toBe(1);
        expect(body.fourStars).toBe(1);
        expect(body.fiveStarHistory.length).toBe(1);
        expect(body.fiveStarHistory[0].itemName).toBe("Main Item 1");
        expect(body.fiveStarHistory[0].gameUid).toBe("UID_MAIN");

        // Verify Redis cache key
        expect(redisStore.has("stats:test-user-id:genshin:UID_MAIN")).toBe(true);
    });

    it("calculates stats for specified gameUid", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item 1', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=UID_ALT", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(1);
        expect(body.fiveStars).toBe(1);
        expect(body.fiveStarHistory[0].itemName).toBe("Alt Item");
        expect(body.fiveStarHistory[0].gameUid).toBe("UID_ALT");

        expect(redisStore.has("stats:test-user-id:genshin:UID_ALT")).toBe(true);
    });

    it("aggregates stats across all UIDs when gameUid=all", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item 1', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(2);
        expect(body.fiveStars).toBe(2);

        expect(redisStore.has("stats:test-user-id:genshin:all")).toBe(true);
    });

    it("synchronizes current pity across shared pity pools (e.g. Genshin 301 and 400)", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1000)`
        );

        // Pull on 301 (3-star), then pull on 400 (3-star), then pull on 301 (3-star)
        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_MAIN', '101', '301', 'ITEM1', 'Item 1', 'weapon', 3, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '102', '400', 'ITEM2', 'Item 2', 'weapon', 3, 1704067300000, 2, 0, 1, 0),
                    ('p-3', 'test-user-id', 'genshin', 'UID_MAIN', '103', '301', 'ITEM3', 'Item 3', 'weapon', 3, 1704067400000, 3, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=UID_MAIN", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        // Both banner 301 and 400 belong to "limited_character" pool, so both should report pity 3
        expect(body.currentPity["301"]).toBe(3);
        expect(body.currentPity["400"]).toBe(3);
    });

    it("calculates current pity using primary account pulls when gameUid=all", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        // Alt has 1 pull, Main has 3 pulls
        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'weapon', 3, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item 1', 'weapon', 3, 1704067300000, 1, 0, 1, 0),
                    ('p-3', 'test-user-id', 'genshin', 'UID_MAIN', '202', '301', 'ITEM3', 'Main Item 2', 'weapon', 3, 1704067400000, 2, 0, 1, 0),
                    ('p-4', 'test-user-id', 'genshin', 'UID_MAIN', '203', '301', 'ITEM4', 'Main Item 3', 'weapon', 3, 1704067500000, 3, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(4);
        // Current pity reflects the primary account only (3 pulls), not the Alt pull
        expect(body.currentPity["301"]).toBe(3);
    });

    it("returns clean zero-value stats structure when user has no pulls or accounts", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(0);
        expect(body.fiveStars).toBe(0);
        expect(body.fourStars).toBe(0);
        expect(body.currentPity).toEqual({});
        expect(body.fiveStarHistory).toEqual([]);
    });

    it("returns 404 when querying a non-existent gameUid", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=NON_EXISTENT", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(404);
        const body = await resp.json();
        expect(body.error).toBe("Game account not found");
    });

    it("serves cached stats on subsequent request without re-querying the database", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-cached', 'test-user-id', 'genshin', 'CACHED_UID', 'Cached', 1, NULL, 1000)`
        );

        const cacheKey = "stats:test-user-id:genshin:CACHED_UID";
        redisStore.set(
            cacheKey,
            JSON.stringify({
                total: 999,
                fiveStars: 50,
                fourStars: 200,
                threeStars: 749,
                pityCurrent: 10,
                avgFiveStarPity: 62.5,
                fiveStarHistory: [],
                bannerBreakdown: {},
            })
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=CACHED_UID", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(999);
        expect(body.fiveStars).toBe(50);
    });

    it("falls back to the earliest-created account when gameUid is omitted and no account is marked primary", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_EARLY', 'Early', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_LATER', 'Later', 0, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-early', 'test-user-id', 'genshin', 'UID_EARLY', '101', '301', 'ITEM1', 'Early Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-later', 'test-user-id', 'genshin', 'UID_LATER', '201', '301', 'ITEM2', 'Later Item', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(1);
        expect(body.fiveStarHistory[0].gameUid).toBe("UID_EARLY");

        // Verify cache key was set for UID_EARLY
        expect(redisStore.has("stats:test-user-id:genshin:UID_EARLY")).toBe(true);
    });
});
