import { describe, it, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { RedisKeys } from "../../../lib/redis-keys";

// 1. Mock DB queries & updates
const mockSettings = {
    userId: "test_user_id",
    theme: "quantum-dark",
    pityDisplayMode: "count_up",
    updatedAt: new Date(),
};

const mockUser = {
    id: "test_user_id",
    email: "user@example.com",
    emailVerified: true,
    isAnonymous: false,
    codeHash: null as string | null,
};

let mockUserEmails: Array<{
    id: string;
    userId: string;
    email: string;
    verified: boolean;
}> = [];

let mockAccount: {
    id: string;
    userId: string;
    providerId: string;
    accountId: string;
} | null = {
    id: "acc_id",
    userId: "test_user_id",
    providerId: "discord",
    accountId: "discord_123",
};

let dbUpdateCalledWith: Record<string, unknown> | null = null;
let dbDeletedCalled = false;

// Mock email library
mock.module("../../../lib/email", () => ({
    sendOtpEmail: mock(async () => {}),
    sendConflictOtpEmail: mock(async () => {}),
}));

// Mock Redis Store
const redisStore = new Map<string, string>();
const redisHashStore = new Map<string, Map<string, string>>();

mock.module("../../../lib/redis", () => ({
    redis: {
        get: mock(async (key: string) => redisStore.get(key) || null),
        set: mock(async (key: string, val: string) => {
            redisStore.set(key, val);
            return "OK";
        }),
        del: mock(async (key: string) => {
            redisStore.delete(key);
            redisHashStore.delete(key);
            return 1;
        }),
        hset: mock(async (key: string, data: Record<string, string | number>) => {
            let hash = redisHashStore.get(key);
            if (!hash) {
                hash = new Map<string, string>();
                redisHashStore.set(key, hash);
            }
            for (const [f, v] of Object.entries(data)) {
                hash.set(f, String(v));
            }
            return Object.keys(data).length;
        }),
        hget: mock(async (key: string, field: string) => {
            return redisHashStore.get(key)?.get(field) || null;
        }),
        hdel: mock(async (key: string, field: string) => {
            const hash = redisHashStore.get(key);
            if (hash) {
                hash.delete(field);
                return 1;
            }
            return 0;
        }),
        hincrby: mock(async (key: string, field: string, increment: number) => {
            let hash = redisHashStore.get(key);
            if (!hash) {
                hash = new Map<string, string>();
                redisHashStore.set(key, hash);
            }
            const val = parseInt(hash.get(field) || "0", 10) + increment;
            hash.set(field, String(val));
            return val;
        }),
        expire: mock(async () => 1),
        incr: mock(async (key: string) => {
            const val = (parseInt(redisStore.get(key) || "0", 10) || 0) + 1;
            redisStore.set(key, String(val));
            return val;
        }),
        ttl: mock(async () => 300),
        exists: mock(async (key: string) => {
            return redisStore.has(key) || redisHashStore.has(key) ? 1 : 0;
        }),
    },
}));

mock.module("../../../db/client", () => ({
    db: {
        query: {
            userSettings: {
                findFirst: mock(async () => mockSettings),
            },
            user: {
                findFirst: mock(async () => mockUser),
            },
            userEmails: {
                findFirst: mock(async () => mockUserEmails[0] || null),
            },
            account: {
                findFirst: mock(async () => mockAccount),
            },
            userGame: {
                findMany: mock(async () => [{ gameUid: "100000001" }, { gameUid: "100000002" }]),
            },
            verification: {
                findFirst: mock(async () => null),
                findMany: mock(async () => []),
            },
        },
        insert: mock(() => {
            const chain = {
                values: mock(() => chain),
                onConflictDoNothing: mock(async () => undefined),
                onConflictDoUpdate: mock((options?: { set?: Record<string, unknown> }) => {
                    if (options?.set) {
                        dbUpdateCalledWith = options.set;
                    }
                    const updateChain = {
                        returning: mock(async () => [mockSettings]),
                        then: (onfulfilled?: (value: unknown) => unknown) =>
                            Promise.resolve(undefined).then(onfulfilled),
                    };
                    return updateChain;
                }),
            };
            return chain;
        }),
        update: mock(() => ({
            set: mock((vals: Record<string, unknown>) => {
                dbUpdateCalledWith = vals;
                return {
                    where: mock(async () => undefined),
                };
            }),
        })),
        delete: mock(() => {
            return {
                where: mock(async () => {
                    dbDeletedCalled = true;
                    return undefined;
                }),
            };
        }),
        select: mock(() => ({
            from: mock(() => ({
                where: mock(async () => [
                    { id: "pull_1", pullId: "p1", gameId: "hsr", rarity: 5, pulledAt: new Date() },
                ]),
            })),
        })),
        transaction: mock(
            async (
                callback: (tx: {
                    delete: (table: unknown) => { where: () => Promise<void> };
                }) => Promise<unknown>
            ) => {
                return await callback({
                    delete: mock(() => {
                        return {
                            where: mock(async () => undefined),
                        };
                    }),
                });
            }
        ),
    },
}));

let originalAuth: typeof import("../../auth/auth");

const mockRevokeSessions = mock(async () => {});

beforeAll(async () => {
    originalAuth = await import("../../auth/auth");

    mock.module("../../auth/auth", () => ({
        ...originalAuth,
        getUserAuthMethodsCount: mock(async () => ({
            primaryEmail: "user@example.com",
            secondaryEmails: [],
            socialAccounts: [{ providerId: "discord" }],
            hasAnonymousCode: false,
            totalActiveCount: 2,
        })),
        signJWT: () => "test_signed_token",
        verifyJWT: () => ({ userId: "user_abc" }),
        generateSessionToken: () => "test_session_token",
        signSessionToken: async () => "test_signed_token",
        auth: {
            ...originalAuth.auth,
            api: {
                ...originalAuth.auth.api,
                getSession: mock(async () => ({
                    user: { id: "test_user_id", name: "User", email: "user@example.com" },
                    session: { token: "session_token" },
                })),
                revokeUserSessions: mockRevokeSessions,
            },
        },
    }));
});

afterAll(() => {
    if (originalAuth) {
        mock.module("../../auth/auth", () => originalAuth);
    }
});

// Helper to build app
async function buildApp() {
    const { userRouter } = await import("../routes");
    return new Elysia().use(userRouter).onError(({ error }) => {
        console.error("ELYSIA TEST ERROR:", error);
    });
}

describe("userRouter — /settings", () => {
    beforeEach(() => {
        dbUpdateCalledWith = null;
        dbDeletedCalled = false;
        mockRevokeSessions.mockClear();
        redisStore.clear();
        redisHashStore.clear();
        mockUser.id = "test_user_id";
        mockUser.email = "user@example.com";
        mockUser.emailVerified = true;
        mockUser.isAnonymous = false;
        mockUser.codeHash = null;
        mockUserEmails = [];
        mockAccount = {
            id: "acc_id",
            userId: "test_user_id",
            providerId: "discord",
            accountId: "discord_123",
        };
    });

    it("GET /user/settings returns correct settings", async () => {
        const app = await buildApp();
        const res = await app.handle(new Request("http://localhost/user/settings"));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.userId).toBe("test_user_id");
        expect(data.theme).toBe("quantum-dark");
        expect(data.pityDisplayMode).toBe("count_up");
    });

    it("PATCH /user/settings updates the settings successfully", async () => {
        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    theme: "wobbly-waves",
                    pityDisplayMode: "count_down",
                }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbUpdateCalledWith?.theme).toBe("wobbly-waves");
        expect(dbUpdateCalledWith?.pityDisplayMode).toBe("count_down");
    });

    it("PATCH /user/settings fails with 422 when invalid values are provided", async () => {
        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    theme: "invalid-theme",
                }),
            })
        );
        expect(res.status).toBe(422);

        const res2 = await app.handle(
            new Request("http://localhost/user/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pityDisplayMode: "invalid-mode",
                }),
            })
        );
        expect(res2.status).toBe(422);
    });
});

describe("userRouter — Account Deletion Re-authentication", () => {
    beforeEach(() => {
        dbUpdateCalledWith = null;
        dbDeletedCalled = false;
        mockRevokeSessions.mockClear();
        redisStore.clear();
        redisHashStore.clear();
        mockUser.id = "test_user_id";
        mockUser.email = "user@example.com";
        mockUser.emailVerified = true;
        mockUser.isAnonymous = false;
        mockUser.codeHash = null;
        mockUserEmails = [];
        mockAccount = {
            id: "acc_id",
            userId: "test_user_id",
            providerId: "discord",
            accountId: "discord_123",
        };
    });

    describe("POST /user/delete-otp", () => {
        it("sends OTP successfully for primary email", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/delete-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "user@example.com" }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);

            // Should have set key in Redis hash store
            const key = RedisKeys.sensitiveActionOtp("test_user_id", "delete-account", "");
            const code = redisHashStore.get(key)?.get("code");
            expect(code).toBeDefined();
            expect(code?.length).toBe(6);
        });

        it("fails with 400 when trying to send OTP to verified secondary email", async () => {
            mockUserEmails.push({
                id: "sec_id",
                userId: "test_user_id",
                email: "secondary@example.com",
                verified: true,
            });

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/delete-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "secondary@example.com" }),
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.error.code).toBe("INVALID_EMAIL");
        });

        it("fails with 400 if email is not linked/verified", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/delete-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "unlinked@example.com" }),
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.error.code).toBe("INVALID_EMAIL");
        });
    });

    describe("DELETE /user", () => {
        it("deletes anonymous account with correct code", async () => {
            mockUser.isAnonymous = true;
            mockUser.codeHash = await Bun.password.hash("1234567812345678");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "anonymous",
                        code: "1234567812345678",
                    }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(dbDeletedCalled).toBe(true);
            expect(mockRevokeSessions).toHaveBeenCalled();
        });

        it("fails deleting anonymous account with incorrect code", async () => {
            mockUser.isAnonymous = true;
            mockUser.codeHash = await Bun.password.hash("1234567812345678");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "anonymous",
                        code: "wrong_code_here",
                    }),
                })
            );
            expect(res.status).toBe(400);
            expect(dbDeletedCalled).toBe(false);
        });

        it("deletes account with correct email OTP", async () => {
            const key = RedisKeys.sensitiveActionOtp("test_user_id", "delete-account", "");
            redisHashStore.set(
                key,
                new Map([
                    ["code", "999888"],
                    ["attempts", "0"],
                ])
            );

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "email",
                        email: "user@example.com",
                        code: "999888",
                    }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(dbDeletedCalled).toBe(true);

            // OTP key should be deleted
            expect(redisHashStore.has(key)).toBe(false);
        });

        it("fails with 400 on incorrect email OTP, and locks out after 5 attempts", async () => {
            const key = RedisKeys.sensitiveActionOtp("test_user_id", "delete-account", "");
            redisHashStore.set(
                key,
                new Map([
                    ["code", "999888"],
                    ["attempts", "0"],
                ])
            );

            const app = await buildApp();

            // Attempts 1-4: return 400
            for (let i = 1; i <= 4; i++) {
                const res = await app.handle(
                    new Request("http://localhost/user", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            type: "email",
                            email: "user@example.com",
                            code: "wrong",
                        }),
                    })
                );
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.error.code).toBe("INVALID_OTP");
            }

            // Attempt 5: fails with 429 and deletes OTP key
            const res5 = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "email",
                        email: "user@example.com",
                        code: "wrong",
                    }),
                })
            );
            expect(res5.status).toBe(429);
            const data5 = await res5.json();
            expect(data5.error.code).toBe("MAX_ATTEMPTS_EXCEEDED");
            expect(redisHashStore.get(key)?.has("code")).toBeUndefined();

            // Attempt 6 (subsequent check): fails with 400 immediately
            const res6 = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "email",
                        email: "user@example.com",
                        code: "correct_but_locked_out",
                    }),
                })
            );
            expect(res6.status).toBe(400);
        });

        it("deletes account with valid social re-authentication key", async () => {
            redisStore.set(RedisKeys.deleteAuth("test_user_id"), "verified");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "social",
                        provider: "discord",
                    }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(dbDeletedCalled).toBe(true);

            // Auth key should be deleted
            expect(redisStore.has(RedisKeys.deleteAuth("test_user_id"))).toBe(false);
        });

        it("fails with 401 if social re-authentication key is missing", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        type: "social",
                        provider: "discord",
                    }),
                })
            );
            expect(res.status).toBe(401);
            expect(dbDeletedCalled).toBe(false);
        });
    });

    describe("DELETE /user/game/:gameId", () => {
        it("fails with 401 when sensitive action OTP is not verified", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/game/genshin", {
                    method: "DELETE",
                })
            );
            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error.code).toBe("VERIFICATION_REQUIRED");
        });

        it("purges game data and invalidates stats caches when verified", async () => {
            const verifiedKey = RedisKeys.sensitiveActionVerified(
                "test_user_id",
                "delete-game",
                "genshin"
            );
            redisStore.set(verifiedKey, "verified");
            redisStore.set("stats:test_user_id:genshin", "cached_stats");
            redisStore.set("stats:test_user_id:genshin:all", "cached_stats_all");
            redisStore.set("stats:test_user_id:genshin:100000001", "cached_stats_acc1");
            redisStore.set("stats:test_user_id:genshin:100000002", "cached_stats_acc2");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/game/genshin", {
                    method: "DELETE",
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);

            // Verified token consumed
            expect(redisStore.has(verifiedKey)).toBe(false);
            // Stats caches cleared
            expect(redisStore.has("stats:test_user_id:genshin")).toBe(false);
            expect(redisStore.has("stats:test_user_id:genshin:all")).toBe(false);
            expect(redisStore.has("stats:test_user_id:genshin:100000001")).toBe(false);
            expect(redisStore.has("stats:test_user_id:genshin:100000002")).toBe(false);
        });

        it("deletes game data for anonymous user with valid code", async () => {
            mockUser.isAnonymous = true;
            mockUser.email = "anon_user@anon.gacha-tracker.app";
            mockUser.codeHash = await Bun.password.hash("1234567890123456");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/game/genshin", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: "1234567890123456" }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
        });
    });
});
