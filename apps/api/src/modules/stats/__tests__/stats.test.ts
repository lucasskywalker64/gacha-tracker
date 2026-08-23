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
        const altFiveStarHistory = JSON.stringify([
            {
                pullId: "101",
                gameUid: "UID_ALT",
                itemId: "ITEM1",
                itemName: "Alt Item",
                pityAtPull: 1,
                wasGuaranteed: 0,
                pulledAt: 1704067200000,
                bannerType: "301",
            },
        ]);
        const mainFiveStarHistory = JSON.stringify([
            {
                pullId: "201",
                gameUid: "UID_MAIN",
                itemId: "ITEM2",
                itemName: "Main Item 1",
                pityAtPull: 1,
                wasGuaranteed: 0,
                pulledAt: 1704067200000,
                bannerType: "301",
            },
        ]);

        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1, 0, 1, '{}', '${altFiveStarHistory}', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2, 1, 1, '{"301":2}', '${mainFiveStarHistory}', 2000)`
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
        const altFiveStarHistory = JSON.stringify([
            {
                pullId: "101",
                gameUid: "UID_ALT",
                itemId: "ITEM1",
                itemName: "Alt Item",
                pityAtPull: 1,
                wasGuaranteed: 0,
                pulledAt: 1704067200000,
                bannerType: "301",
            },
        ]);

        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1, 0, 1, '{}', '${altFiveStarHistory}', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1, 0, 1, '{}', '[]', 2000)`
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
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1, 0, 1, '{}', '[]', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1, 0, 1, '{}', '[]', 2000)`
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
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 3, 0, 0, '{"301":3,"400":3}', '[]', 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=UID_MAIN", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.currentPity["301"]).toBe(3);
        expect(body.currentPity["400"]).toBe(3);
    });

    it("calculates current pity using primary account pulls when gameUid=all", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1, 0, 0, '{"301":1}', '[]', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 3, 0, 0, '{"301":3}', '[]', 2000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.total).toBe(4);
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
        const earlyFiveStarHistory = JSON.stringify([
            {
                pullId: "101",
                gameUid: "UID_EARLY",
                itemId: "ITEM1",
                itemName: "Early Item",
                pityAtPull: 1,
                wasGuaranteed: 0,
                pulledAt: 1704067200000,
                bannerType: "301",
            },
        ]);

        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_EARLY', 'Early', 0, NULL, 1, 0, 1, '{}', '${earlyFiveStarHistory}', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_LATER', 'Later', 0, NULL, 1, 0, 1, '{}', '[]', 2000)`
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

    it("preserves identical pullIds across different gameUids when aggregating with gameUid=all", async () => {
        const altFiveStarHistory = JSON.stringify([
            {
                pullId: "101",
                gameUid: "UID_ALT",
                itemId: "ITEM1",
                itemName: "Alt Item",
                pityAtPull: 1,
                wasGuaranteed: 0,
                pulledAt: 1704067200000,
                bannerType: "301",
            },
        ]);
        const mainFiveStarHistory = JSON.stringify([
            {
                pullId: "101",
                gameUid: "UID_MAIN",
                itemId: "ITEM2",
                itemName: "Main Item",
                pityAtPull: 2,
                wasGuaranteed: 0,
                pulledAt: 1704067300000,
                bannerType: "301",
            },
        ]);
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, stats_total_pulls, stats_four_stars, stats_five_stars, stats_current_pity, stats_five_star_history, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1, 0, 1, '{}', '${altFiveStarHistory}', 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1, 0, 1, '{}', '${mainFiveStarHistory}', 2000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/stats/genshin?gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.fiveStarHistory.length).toBe(2);
        expect(body.fiveStarHistory.map((h: { id: string }) => h.id)).toEqual([
            "UID_MAIN:101",
            "UID_ALT:101",
        ]);
        expect(body.fiveStarHistory.map((h: { pullId: string }) => h.pullId)).toEqual([
            "101",
            "101",
        ]);
    });
});
