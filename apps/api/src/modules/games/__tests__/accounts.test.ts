import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../../db/schema";
import { createTestTables } from "../../pulls/db-setup.helper";
import { RedisKeys } from "../../../lib/redis-keys";

// --- Mocks ---
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

describe("Game Accounts API", () => {
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
        await sqlite.execute(`DELETE FROM user`);
        await sqlite.execute(`DELETE FROM game`);
        await sqlite.execute(
            `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('test-user-id', 'Test', 'test@example.com', 1, 0, 0)`
        );
        await sqlite.execute(
            `INSERT INTO game (id, display_name, is_active, config, created_at) VALUES ('genshin', 'Genshin Impact', 1, '{}', 0)`
        );

        const { accountsRouter } = await import("../accounts");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app = new Elysia().use(accountsRouter as any);
    });

    beforeEach(async () => {
        redisStore.clear();
        await sqlite.execute(`DELETE FROM pull`);
        await sqlite.execute(`DELETE FROM user_game`);
        await sqlite.execute(`DELETE FROM user WHERE id = 'test-user-id'`);
        await sqlite.execute(
            `INSERT INTO user (id, name, email, email_verified, is_anonymous, code_hash, created_at, updated_at)
             VALUES ('test-user-id', 'Test', 'test@example.com', 1, 0, NULL, 0, 0)`
        );
    });

    it("GET /games/:gameId/accounts - returns empty array when no accounts exist", async () => {
        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.accounts).toEqual([]);
    });

    it("GET /games/:gameId/accounts - returns list of accounts ordered with primary first", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Alt Account', 0, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', '100000002', 'Main Account', 1, NULL, 2000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts", {
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);
        const body = await resp.json();
        expect(body.accounts.length).toBe(2);
        expect(body.accounts[0].gameUid).toBe("100000002");
        expect(body.accounts[0].isPrimary).toBe(true);
        expect(body.accounts[1].gameUid).toBe("100000001");
        expect(body.accounts[1].isPrimary).toBe(false);
    });

    it("PATCH /games/:gameId/accounts/:gameUid - updates nickname and switches primary account atomically", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Old Nickname', 1, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', '100000002', 'Alt', 0, NULL, 2000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000002", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    nickname: "New Alt Name",
                    isPrimary: true,
                }),
            })
        );
        expect(resp.status).toBe(200);

        const updated = await testDb.query.userGame.findMany({
            where: (ug, { eq }) => eq(ug.userId, "test-user-id"),
        });
        const acc1 = updated.find((a) => a.gameUid === "100000001");
        const acc2 = updated.find((a) => a.gameUid === "100000002");

        expect(acc1?.isPrimary).toBe(false);
        expect(acc2?.isPrimary).toBe(true);
        expect(acc2?.nickname).toBe("New Alt Name");
    });

    it("PATCH /games/:gameId/accounts/:gameUid - rejects manual demotion attempts (isPrimary: false)", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Main', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    isPrimary: false,
                }),
            })
        );
        expect(resp.status).toBe(422);
    });

    it("DELETE /games/:gameId/accounts/:gameUid - fails with 401 when sensitive action is unverified", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Primary Account', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer session_token",
                },
            })
        );
        expect(resp.status).toBe(401);
    });

    it("DELETE /games/:gameId/accounts/:gameUid - removes account and cascade-deletes pull history when verified", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Primary Account', 1, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', '100000002', 'Secondary Account', 0, NULL, 2000)`
        );

        await sqlite.execute(
            `INSERT INTO pull (user_id, game_id, game_uid, pull_id, banner_type, item_id, item_name, item_type, rarity, pulled_at, pity_at_pull, was_guaranteed, pity_version, created_at)
             VALUES ('test-user-id', 'genshin', '100000001', 'PULL_1', '301', 'ITEM1', 'Venti', 'character', 5, 1704067200000, 1, 0, 1, 0),
                    ('test-user-id', 'genshin', '100000002', 'PULL_2', '301', 'ITEM2', 'Diluc', 'character', 5, 1704067200000, 1, 0, 1, 0)`
        );

        // Set sensitive action verified token in Redis
        const verifiedKey = RedisKeys.sensitiveActionVerified(
            "test-user-id",
            "delete-profile",
            "genshin:100000001"
        );
        redisStore.set(verifiedKey, "verified");

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer session_token",
                },
            })
        );
        expect(resp.status).toBe(200);

        // Account 1 should be gone
        const remainingAccounts = await testDb.query.userGame.findMany({
            where: (ug, { eq }) => eq(ug.userId, "test-user-id"),
        });
        expect(remainingAccounts.length).toBe(1);
        expect(remainingAccounts[0].gameUid).toBe("100000002");
        expect(remainingAccounts[0].isPrimary).toBe(true); // Promoted to primary!

        // Pulls for account 1 should be deleted, account 2 preserved
        const remainingPulls = await testDb.query.pull.findMany({
            where: (p, { eq }) => eq(p.userId, "test-user-id"),
        });
        expect(remainingPulls.length).toBe(1);
        expect(remainingPulls[0].gameUid).toBe("100000002");

        // Verified token in Redis should be consumed/deleted
        expect(redisStore.has(verifiedKey)).toBe(false);
    });

    it("DELETE /games/:gameId/accounts/:gameUid - verifies anonymous code for anonymous users", async () => {
        const hashedCode = await Bun.password.hash("1234567890123456");
        await sqlite.execute(`DELETE FROM user WHERE id = 'test-user-id'`);
        await sqlite.execute({
            sql: `INSERT INTO user (id, name, email, email_verified, is_anonymous, code_hash, created_at, updated_at)
                  VALUES ('test-user-id', 'Anon', 'anon_user@anon.gacha-tracker.app', 1, 1, ?, 0, 0)`,
            args: [hashedCode],
        });

        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Primary Account', 1, NULL, 1000)`
        );

        // Invalid code
        const invalidResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ code: "wrongcode1234567" }),
            })
        );
        expect(invalidResp.status).toBe(400);

        // Valid code
        const validResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ code: "1234567890123456" }),
            })
        );
        expect(validResp.status).toBe(200);

        const remainingAccounts = await testDb.query.userGame.findMany({
            where: (ug, { eq }) => eq(ug.userId, "test-user-id"),
        });
        expect(remainingAccounts.length).toBe(0);
    });

    it("DELETE /games/:gameId/accounts/:gameUid - deletes only account without throwing when no remaining accounts exist", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Solo Account', 1, NULL, 1000)`
        );

        const verifiedKey = RedisKeys.sensitiveActionVerified(
            "test-user-id",
            "delete-profile",
            "genshin:100000001"
        );
        redisStore.set(verifiedKey, "verified");

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);

        const remaining = await testDb.query.userGame.findMany({
            where: (ug, { eq }) => eq(ug.userId, "test-user-id"),
        });
        expect(remaining.length).toBe(0);
    });

    it("DELETE /games/:gameId/accounts/:gameUid - deleting a secondary account preserves primary account without mutating it", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Primary Main', 1, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', '100000002', 'Alt Secondary', 0, NULL, 2000)`
        );

        const verifiedKey = RedisKeys.sensitiveActionVerified(
            "test-user-id",
            "delete-profile",
            "genshin:100000002"
        );
        redisStore.set(verifiedKey, "verified");

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000002", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(resp.status).toBe(200);

        const remaining = await testDb.query.userGame.findMany({
            where: (ug, { eq }) => eq(ug.userId, "test-user-id"),
        });
        expect(remaining.length).toBe(1);
        expect(remaining[0].gameUid).toBe("100000001");
        expect(remaining[0].isPrimary).toBe(true);
        expect(remaining[0].nickname).toBe("Primary Main");
    });

    it("PATCH & DELETE /games/:gameId/accounts/:gameUid - cross-user isolation prevents modifying or deleting another user's account", async () => {
        // Create account belonging to another user
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-other', 'other-user-id', 'genshin', '999999999', 'Other User Acc', 1, NULL, 1000)`
        );

        // Attempt PATCH
        const patchResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/999999999", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ nickname: "Hacked Nickname" }),
            })
        );
        expect(patchResp.status).toBe(404);

        // Attempt DELETE with verified token
        const verifiedKey = RedisKeys.sensitiveActionVerified(
            "test-user-id",
            "delete-profile",
            "genshin:999999999"
        );
        redisStore.set(verifiedKey, "verified");

        const deleteResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/999999999", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(deleteResp.status).toBe(404);

        // Ensure other user's record was untouched
        const otherRecord = await testDb.query.userGame.findFirst({
            where: (ug, { eq }) => eq(ug.id, "acc-other"),
        });
        expect(otherRecord).toBeDefined();
        expect(otherRecord?.nickname).toBe("Other User Acc");
    });

    it("DELETE /games/:gameId/accounts/:gameUid - fails with 401 on target mismatch or token replay", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Main', 1, NULL, 1000),
                    ('acc-2', 'test-user-id', 'genshin', '100000002', 'Alt', 0, NULL, 2000)`
        );

        // 1. Target mismatch: token verified for acc-1 (100000001) used to try deleting acc-2 (100000002)
        const verifiedKey1 = RedisKeys.sensitiveActionVerified(
            "test-user-id",
            "delete-profile",
            "genshin:100000001"
        );
        redisStore.set(verifiedKey1, "verified");

        const mismatchResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000002", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(mismatchResp.status).toBe(401);

        // 2. Token replay: successful delete of acc-1 consumes token, replay must fail
        const deleteResp1 = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(deleteResp1.status).toBe(200);

        // Re-create the account so the existence check passes and the token check is exercised
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1b', 'test-user-id', 'genshin', '100000001', 'Main', 0, NULL, 3000)`
        );

        const replayResp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "DELETE",
                headers: { Authorization: "Bearer session_token" },
            })
        );
        expect(replayResp.status).toBe(401);
    });

    it("PATCH /games/:gameId/accounts/:gameUid - setting nickname to null clears the nickname", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Has Nickname', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ nickname: null }),
            })
        );
        expect(resp.status).toBe(200);

        const updated = await testDb.query.userGame.findFirst({
            where: (ug, { eq }) => eq(ug.id, "acc-1"),
        });
        expect(updated?.nickname).toBeNull();
    });

    it("PATCH /games/:gameId/accounts/:gameUid - setting isPrimary: true when already primary succeeds idempotently", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Main', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ isPrimary: true }),
            })
        );
        expect(resp.status).toBe(200);

        const updated = await testDb.query.userGame.findFirst({
            where: (ug, { eq }) => eq(ug.id, "acc-1"),
        });
        expect(updated?.isPrimary).toBe(true);
    });

    it("PATCH /games/:gameId/accounts/:gameUid - rejects nickname exceeding 50 characters", async () => {
        await sqlite.execute(
            `INSERT INTO user_game (id, user_id, game_id, game_uid, nickname, is_primary, last_import, created_at)
             VALUES ('acc-1', 'test-user-id', 'genshin', '100000001', 'Main', 1, NULL, 1000)`
        );

        const resp = await app.fetch(
            new Request("http://localhost/games/genshin/accounts/100000001", {
                method: "PATCH",
                headers: {
                    Authorization: "Bearer session_token",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ nickname: "a".repeat(51) }),
            })
        );
        expect(resp.status).toBe(422);
    });
});
