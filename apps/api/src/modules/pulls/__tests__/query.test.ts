import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../../db/schema";
import { createTestTables } from "../db-setup.helper";

const sqlite = createClient({ url: "file::memory:?cache=shared" });
const testDb = drizzle(sqlite, { schema });

describe("Pulls Query API (Multi-Account)", () => {
    let app: Elysia;
    let originalAuth: typeof import("../../auth/auth");

    afterAll(() => {
        if (originalAuth) {
            mock.module("../../auth/auth", () => originalAuth);
        }
    });

    beforeAll(async () => {
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

        const { queryRouter } = await import("../query");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app = new Elysia().use(queryRouter as any);
    });

    beforeEach(async () => {
        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
    });

    it("defaults to primary game account pulls when gameUid is omitted", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data.length).toBe(1);
        expect(body.data[0].gameUid).toBe("UID_MAIN");
        expect(body.data[0].itemName).toBe("Main Item");
    });

    it("defaults to earliest-created game account pulls when gameUid is omitted and no account is marked primary", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_EARLY', 'Early', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_LATER', 'Later', 0, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_EARLY', '101', '301', 'ITEM1', 'Early Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_LATER', '201', '301', 'ITEM2', 'Later Item', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data.length).toBe(1);
        expect(body.data[0].gameUid).toBe("UID_EARLY");
        expect(body.data[0].itemName).toBe("Early Item");
    });

    it("filters pulls by specified gameUid", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin&gameUid=UID_ALT", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data.length).toBe(1);
        expect(body.data[0].gameUid).toBe("UID_ALT");
        expect(body.data[0].itemName).toBe("Alt Item");
    });

    it("returns all pulls across all UIDs when gameUid=all", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_ALT', 'Alt', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_ALT', '101', '301', 'ITEM1', 'Alt Item', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('p-2', 'test-user-id', 'genshin', 'UID_MAIN', '201', '301', 'ITEM2', 'Main Item', 'character', 5, 1704067300000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin&gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data.length).toBe(2);
    });

    it("returns empty array and 0 total when user has no accounts or pulls for the game", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
        expect(body.meta.hasNextPage).toBe(false);
    });

    it("returns empty array and 0 total when querying a non-existent gameUid", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', 'UID_MAIN', 'Main', 1, NULL, 1000)`
        );
        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-1', 'test-user-id', 'genshin', 'UID_MAIN', '101', '301', 'ITEM1', 'Main Item', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin&gameUid=NON_EXISTENT_UID", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
    });

    it("maintains cross-user isolation and never returns another user's pulls", async () => {
        // Other user has pulls with UID_MAIN
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-other', 'other-user-id', 'genshin', 'UID_MAIN', 'Other Main', 1, NULL, 1000)`
        );
        await sqlite.execute(
            `INSERT INTO pull (id, user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('p-other', 'other-user-id', 'genshin', 'UID_MAIN', 'PULL_OTHER', '301', 'ITEM1', 'Secret 5 Star', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/pulls?gameId=genshin&gameUid=all", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
    });
});
