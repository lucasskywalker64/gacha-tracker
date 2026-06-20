/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";
import { RedisKeys } from "../../../lib/redis-keys";

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

let mockRateLimitResult = { limited: false, remaining: 5, retryAfter: 3600 };
let mockResendLimitResult = { limited: false, remaining: 1, retryAfter: 60 };
let mockIpLimitResult = { limited: false, remaining: 20, retryAfter: 3600 };
let mockIpHardLimitResult = { limited: false, remaining: 50, retryAfter: 3600 };

const mockCheckRateLimit = mock(
    async (options: { action: string; ip: string; limit: number; windowSeconds: number }) => {
        if (options.action === "link_email_ip") {
            return mockIpLimitResult;
        }
        if (options.action === "link_email_ip_hard") {
            return mockIpHardLimitResult;
        }
        if (options.action === "link_email_user") {
            return mockRateLimitResult;
        }
        if (options.action === "link_email_resend") {
            return mockResendLimitResult;
        }
        const key = `rate_limit:${options.action}:${options.ip}`;
        const currentVal = parseInt(redisStore.get(key) || "0", 10) || 0;
        const newCount = currentVal + 1;
        redisStore.set(key, String(newCount));
        if (newCount > options.limit) {
            return {
                limited: true,
                remaining: 0,
                retryAfter: options.windowSeconds,
            };
        }
        return {
            limited: false,
            remaining: Math.max(0, options.limit - newCount),
            retryAfter: options.windowSeconds,
        };
    }
);

mock.module("../../../lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
}));

// Mock DB client and drizzle-orm
const mockUser = {
    id: "test_user_id",
    name: "User",
    email: "user@example.com",
    isAnonymous: false,
    codeHash: null,
};

let mockSecondaryEmails: Array<{ email: string; verified: boolean; userId: string }> = [];
let mockAccounts: Array<{ providerId: string; userId: string }> = [];
let dbUpdateCalled: Record<string, unknown> | null = null;
let dbInsertCalled = false;

const mockFindFirstUser = mock(async (): Promise<any> => mockUser) as any;

const hasIdProperty = (obj: any, visited = new Set()): boolean => {
    if (!obj || typeof obj !== "object") return false;
    if (visited.has(obj)) return false;
    visited.add(obj);

    if (obj.name === "id") return true;

    for (const key of Object.keys(obj)) {
        if (key === "table" || key === "schema" || key === "relations" || key === "db") continue;
        try {
            if (hasIdProperty(obj[key], visited)) return true;
        } catch {
            // Ignore error
        }
    }
    return false;
};

const mockFindFirstUserWrapper = async (options?: any) => {
    const isIdQuery = options && options.where && hasIdProperty(options.where);
    if (isIdQuery) {
        return mockUser;
    }
    return await mockFindFirstUser(options);
};

const mockFindFirstUserEmails = mock(async () => null as any) as any;
const mockFindManyUserEmails = mock(async () => mockSecondaryEmails as any) as any;
const mockFindManyAccounts = mock(async () => mockAccounts as any) as any;

mock.module("../../../db/client", () => ({
    db: {
        query: {
            user: {
                findFirst: mockFindFirstUserWrapper as any,
            },
            userEmails: {
                findFirst: mockFindFirstUserEmails as any,
                findMany: mockFindManyUserEmails as any,
            },
            account: {
                findMany: mockFindManyAccounts as any,
            },
            verification: {
                findFirst: mock(async () => null),
                findMany: mock(async () => []),
            },
        },
        insert: mock(() => ({
            values: mock(async () => {
                dbInsertCalled = true;
                return undefined;
            }),
        })),
        update: mock(() => ({
            set: mock((vals: Record<string, unknown>) => {
                dbUpdateCalled = vals;
                return {
                    where: mock(async () => undefined),
                };
            }),
        })),
        delete: mock(() => ({
            where: mock(async () => undefined),
        })),
        transaction: mock(async (callback: (tx: any) => Promise<unknown>) => {
            return await callback({
                delete: mock(() => ({
                    where: mock(async () => undefined),
                })),
                update: mock(() => ({
                    set: mock(() => ({
                        where: mock(async () => undefined),
                    })),
                })),
            });
        }),
    },
}));

let originalAuth: any;

beforeAll(async () => {
    originalAuth = await import("../../auth/auth");

    mock.module("../../auth/auth", () => ({
        ...originalAuth,
        getUserAuthMethodsCount: mock(async () => {
            const primaryEmailReal = !mockUser.email.endsWith("@anon.gacha-tracker.app");
            let totalActiveCount = 0;
            if (primaryEmailReal) totalActiveCount++;
            totalActiveCount += mockSecondaryEmails.filter((e) => e.verified).length;
            totalActiveCount += mockAccounts.length;

            return {
                primaryEmail: primaryEmailReal ? mockUser.email : null,
                secondaryEmails: mockSecondaryEmails,
                socialAccounts: mockAccounts,
                hasAnonymousCode: false,
                totalActiveCount,
            };
        }),
        signJWT: () => "test_token",
        verifyJWT: () => ({ userId: "test_user_id", email: "user.secondary@example.com" }),
        auth: {
            ...originalAuth.auth,
            api: {
                ...originalAuth.auth.api,
                getSession: mock(async () => ({
                    user: mockUser,
                    session: { token: "session_token" },
                })),
                revokeUserSessions: mock(async () => {}),
            },
        },
    }));
});

afterAll(() => {
    if (originalAuth) {
        mock.module("../../auth/auth", () => originalAuth);
    }
});

mock.module("../../../lib/email", () => ({
    sendOtpEmail: mock(async () => {}),
    sendConflictOtpEmail: mock(async () => {}),
}));

mock.module("../../../config", () => ({
    config: {
        BETTER_AUTH_SECRET: "test_secret_key_minimum_length_32_characters",
        BETTER_AUTH_URL: "http://localhost:3000",
        FRONTEND_URL: "http://localhost:5173",
    },
    IMPORT_TOKEN_TTL_SECONDS: 900,
    ANON_PENDING_TTL_SECONDS: 900,
}));

async function buildApp() {
    const { userRouter } = await import("../routes");
    return new Elysia().use(userRouter);
}

describe("userRouter — Email Linking & Safety Controls", () => {
    beforeEach(() => {
        redisStore.clear();
        mockUser.email = "user@example.com";
        mockSecondaryEmails = [];
        mockAccounts = [];
        dbUpdateCalled = null;
        dbInsertCalled = false;
        mockRateLimitResult = { limited: false, remaining: 5, retryAfter: 3600 };
        mockIpLimitResult = { limited: false, remaining: 20, retryAfter: 3600 };
        mockIpHardLimitResult = { limited: false, remaining: 50, retryAfter: 3600 };

        mockFindFirstUser.mockReset();
        mockFindFirstUser.mockImplementation(async () => mockUser);

        mockFindFirstUserEmails.mockReset();
        mockFindFirstUserEmails.mockImplementation(async () => mockSecondaryEmails[0] || null);

        mockFindManyUserEmails.mockReset();
        mockFindManyUserEmails.mockImplementation(async () => mockSecondaryEmails);

        mockFindManyAccounts.mockReset();
        mockFindManyAccounts.mockImplementation(async () => mockAccounts);
    });

    it("GET /user/auth-methods aggregates counts accurately", async () => {
        mockAccounts = [{ providerId: "discord", userId: "test_user_id" }];
        mockSecondaryEmails = [
            { email: "user.secondary.active@example.com", verified: true, userId: "test_user_id" },
        ];

        const app = await buildApp();
        const res = await app.handle(new Request("http://localhost/user/auth-methods"));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.primaryEmail).toBe("user@example.com");
        expect(data.totalActiveCount).toBe(3); // primary email + 1 secondary + 1 social
    });

    it("POST /user/unlink-email rejects when no verified secondary email exists", async () => {
        mockAccounts = [];
        mockSecondaryEmails = [];

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/unlink-email", { method: "POST" })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe("NO_VERIFIED_SECONDARY_EMAIL");
        expect(dbUpdateCalled).toBeNull();
    });

    it("POST /user/unlink-email rejects even if other auth methods exist if no verified secondary email exists", async () => {
        mockAccounts = [{ providerId: "discord", userId: "test_user_id" }];

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/unlink-email", { method: "POST" })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe("NO_VERIFIED_SECONDARY_EMAIL");
        expect(dbUpdateCalled).toBeNull();
    });

    it("POST /user/unlink-email auto-promotes verified secondary if unlinking primary email", async () => {
        mockAccounts = [];
        mockSecondaryEmails = [
            { email: "user.secondary.active@example.com", verified: true, userId: "test_user_id" },
        ];

        // Seed OTP
        const key = RedisKeys.unlinkEmailOtp("test_user_id", "user@example.com");
        redisHashStore.set(
            key,
            new Map([
                ["code", "123456"],
                ["attempts", "0"],
            ])
        );

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/unlink-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "123456" }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it("POST /user/unlink-email rejects when multiple verified secondaries exist and no emailToPromote is specified", async () => {
        mockAccounts = [];
        mockSecondaryEmails = [
            { email: "user.secondary1@example.com", verified: true, userId: "test_user_id" },
            { email: "user.secondary2@example.com", verified: true, userId: "test_user_id" },
        ];

        // Seed OTP
        const key = RedisKeys.unlinkEmailOtp("test_user_id", "user@example.com");
        redisHashStore.set(
            key,
            new Map([
                ["code", "123456"],
                ["attempts", "0"],
            ])
        );

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/unlink-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "123456" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe("MULTIPLE_VERIFIED_EMAILS");
    });

    it("POST /user/unlink-email succeeds when emailToPromote is explicitly specified among multiple", async () => {
        mockAccounts = [];
        mockSecondaryEmails = [
            { email: "user.secondary1@example.com", verified: true, userId: "test_user_id" },
            { email: "user.secondary2@example.com", verified: true, userId: "test_user_id" },
        ];

        // Seed OTP
        const key = RedisKeys.unlinkEmailOtp("test_user_id", "user@example.com");
        redisHashStore.set(
            key,
            new Map([
                ["code", "123456"],
                ["attempts", "0"],
            ])
        );

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/unlink-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: "123456",
                    emailToPromote: "user.secondary2@example.com",
                }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.email).toBe("user.secondary2@example.com");
    });

    describe("Primary Email Unlink OTP Verification Flow", () => {
        beforeEach(() => {
            mockAccounts = [];
            mockSecondaryEmails = [
                {
                    email: "user.secondary.active@example.com",
                    verified: true,
                    userId: "test_user_id",
                },
            ];
        });

        it("POST /user/unlink-email-otp sends OTP successfully for primary email", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email-otp", {
                    method: "POST",
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);

            // Should have set key in Redis hash store
            const key = RedisKeys.unlinkEmailOtp("test_user_id", "user@example.com");
            const code = redisHashStore.get(key)?.get("code");
            expect(code).toBeDefined();
            expect(code?.length).toBe(6);
        });

        it("POST /user/unlink-email-otp fails if no verified secondary emails exist", async () => {
            mockSecondaryEmails = [];

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email-otp", {
                    method: "POST",
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("NO_VERIFIED_SECONDARY_EMAIL");
        });

        it("POST /user/unlink-email fails if no OTP code is provided in request body", async () => {
            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("INVALID_OTP");
            expect(data.error.message).toBe("Verification code is required.");
        });

        it("POST /user/unlink-email fails with 400 on incorrect email OTP, and locks out after 5 attempts", async () => {
            const key = RedisKeys.unlinkEmailOtp("test_user_id", "user@example.com");
            redisHashStore.set(
                key,
                new Map([
                    ["code", "123456"],
                    ["attempts", "0"],
                ])
            );

            const app = await buildApp();

            // Attempts 1-4: return 400
            for (let i = 1; i <= 4; i++) {
                const res = await app.handle(
                    new Request("http://localhost/user/unlink-email", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
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
                new Request("http://localhost/user/unlink-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code: "wrong",
                    }),
                })
            );
            expect(res5.status).toBe(429);
            const data5 = await res5.json();
            expect(data5.error.code).toBe("MAX_ATTEMPTS_EXCEEDED");
            expect(redisHashStore.get(key)?.has("code")).toBeUndefined();
        });

        it("POST /user/unlink-email succeeds and skips OTP check for anonymous primary email", async () => {
            mockUser.email = "anon-user@anon.gacha-tracker.app";
            mockUser.isAnonymous = true;

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
        });

        it("POST /user/unlink-email-otp sends OTP successfully to a secondary email verified for >= 48 hours", async () => {
            mockSecondaryEmails = [
                {
                    email: "recovery@example.com",
                    verified: true,
                    userId: "test_user_id",
                    verifiedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), // 49 hours ago
                    createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
                } as any,
            ];

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ useSecondaryEmail: "recovery@example.com" }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);

            const key = RedisKeys.unlinkEmailOtp("test_user_id", "recovery@example.com");
            const code = redisHashStore.get(key)?.get("code");
            expect(code).toBeDefined();
        });

        it("POST /user/unlink-email-otp fails if secondary email verified for < 48 hours", async () => {
            mockSecondaryEmails = [
                {
                    email: "recovery@example.com",
                    verified: true,
                    userId: "test_user_id",
                    verifiedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
                    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
                } as any,
            ];

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email-otp", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ useSecondaryEmail: "recovery@example.com" }),
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("VERIFICATION_PERIOD_INSUFFICIENT");
        });

        it("POST /user/unlink-email succeeds when verifying with OTP sent to secondary email verified for >= 48 hours", async () => {
            mockSecondaryEmails = [
                {
                    email: "recovery@example.com",
                    verified: true,
                    userId: "test_user_id",
                    verifiedAt: new Date(Date.now() - 49 * 60 * 60 * 1000), // 49 hours ago
                    createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
                } as any,
            ];

            const key = RedisKeys.unlinkEmailOtp("test_user_id", "recovery@example.com");
            redisHashStore.set(
                key,
                new Map([
                    ["code", "654321"],
                    ["attempts", "0"],
                ])
            );

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code: "654321",
                        emailToPromote: "recovery@example.com",
                    }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.email).toBe("recovery@example.com");
        });

        it("POST /user/unlink-email fails if secondary email OTP is used but verified for < 48 hours", async () => {
            mockSecondaryEmails = [
                {
                    email: "recovery@example.com",
                    verified: true,
                    userId: "test_user_id",
                    verifiedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
                    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
                } as any,
            ];

            const key = RedisKeys.unlinkEmailOtp("test_user_id", "recovery@example.com");
            redisHashStore.set(
                key,
                new Map([
                    ["code", "654321"],
                    ["attempts", "0"],
                ])
            );

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        code: "654321",
                        emailToPromote: "recovery@example.com",
                    }),
                })
            );
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("VERIFICATION_PERIOD_INSUFFICIENT");
        });
    });

    it("POST /user/link-email starts linking process by creating unverified row and sending code", async () => {
        mockFindFirstUser.mockImplementation(async () => null); // search by email -> not found
        mockFindFirstUserEmails.mockImplementation(async () => null);

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.new@example.com" }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbInsertCalled).toBe(true);
    });

    it("POST /user/link-email/verify returns success when unverified row and Redis token exists", async () => {
        mockFindFirstUser.mockImplementation(async () => mockUser);
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_id",
            userId: "test_user_id",
            email: "user.secondary@example.com",
            verified: false,
        }));

        // Seed OTP in Redis
        const key = RedisKeys.linkEmailOtp("test_user_id", "user.secondary@example.com");
        redisHashStore.set(
            key,
            new Map([
                ["code", "123456"],
                ["attempts", "0"],
            ])
        );

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.secondary@example.com", code: "123456" }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.promoted).toBe(false);

        // Verify OTP is deleted from Redis
        expect(redisHashStore.has(key)).toBe(false);
    });

    it("POST /user/link-email/verify returns 400 when unverified row has been canceled/deleted or token expired", async () => {
        mockFindFirstUser.mockImplementation(async () => mockUser);
        mockFindFirstUserEmails.mockImplementation(async () => null); // row deleted/canceled

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.secondary@example.com", code: "123456" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
    });

    it("POST /user/link-email for own primary email returns 400 with EMAIL_ALREADY_LINKED", async () => {
        mockFindFirstUser.mockImplementation(async () => mockUser);

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: mockUser.email }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe("EMAIL_ALREADY_LINKED");
    });

    it("POST /user/link-email for own verified secondary email returns 400 with EMAIL_ALREADY_LINKED", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_id",
            userId: "test_user_id",
            email: "user.secondary@example.com",
            verified: true,
            createdAt: new Date(),
        }));

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.secondary@example.com" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.code).toBe("EMAIL_ALREADY_LINKED");
    });

    it("POST /user/link-email for another user's primary email returns 400 with EMAIL_IN_USE", async () => {
        mockFindFirstUser.mockImplementation(async () => ({
            id: "other_user_id",
            name: "Other User",
            email: "other@example.com",
        }));
        dbInsertCalled = false;

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "other@example.com" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("EMAIL_IN_USE");
        expect(data.error.message).toBe("This email address is already in use by another user.");
        expect(dbInsertCalled).toBe(false); // Did not write unverified row for this user
    });

    it("POST /user/link-email for another user's verified secondary email returns 400 with EMAIL_IN_USE", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_id",
            userId: "other_user_id",
            email: "other.secondary@example.com",
            verified: true,
            createdAt: new Date(),
        }));
        dbInsertCalled = false;

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "other.secondary@example.com" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("EMAIL_IN_USE");
        expect(data.error.message).toBe("This email address is already in use by another user.");
        expect(dbInsertCalled).toBe(false);
    });

    it("POST /user/link-email for another user's pending secondary email within 15 minutes returns 400 with EMAIL_IN_USE", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_id",
            userId: "other_user_id",
            email: "other.pending@example.com",
            verified: false,
            createdAt: new Date(), // within window
        }));
        dbInsertCalled = false;

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "other.pending@example.com" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("EMAIL_IN_USE");
        expect(data.error.message).toBe("This email address is already in use by another user.");
        expect(dbInsertCalled).toBe(false);
    });

    it("POST /user/link-email for another user's expired pending email deletes stale row and sends new verification", async () => {
        mockFindFirstUser.mockImplementation(async () => null);

        let callCount = 0;
        mockFindFirstUserEmails.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    id: "sec_id",
                    userId: "other_user_id",
                    email: "other.expired@example.com",
                    verified: false,
                    createdAt: new Date(Date.now() - 16 * 60 * 1000), // 16 minutes ago (expired)
                };
            }
            return null; // For the second findFirst call (looking for own pending row)
        });
        dbInsertCalled = false;

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "other.expired@example.com" }),
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbInsertCalled).toBe(true); // Deletes expired User B row and inserts new unverified User A row
    });

    it("POST /user/link-email invalidates previous pending OTP code upon a resend/new request (U-02)", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => null);

        const app = await buildApp();

        // First link request
        await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.resend@example.com" }),
            })
        );

        const key = RedisKeys.linkEmailOtp("test_user_id", "user.resend@example.com");
        const firstCode = redisHashStore.get(key)?.get("code");
        expect(firstCode).toBeDefined();

        // Second link request (resend)
        await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.resend@example.com" }),
            })
        );

        const secondCode = redisHashStore.get(key)?.get("code");
        expect(secondCode).toBeDefined();
        expect(secondCode).not.toBe(firstCode);
    });

    it("POST /user/link-email resend rate limit triggers 429 and delta-seconds Retry-After in seconds", async () => {
        mockSecondaryEmails = [
            { email: "user.resendrate@example.com", verified: false, userId: "test_user_id" },
        ];
        mockResendLimitResult = { limited: true, remaining: 0, retryAfter: 45 };

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.resendrate@example.com" }),
            })
        );
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("45");
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("TOO_MANY_REQUESTS");
        expect(data.error.message).toBe(
            "Too many resend attempts. Please try again in 45 seconds."
        );
    });

    it("POST /user/link-email user-level rate limit triggers 429 and delta-seconds Retry-After", async () => {
        mockRateLimitResult = { limited: true, remaining: 0, retryAfter: 1234 };

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "user.rate@example.com" }),
            })
        );
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("1234");
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("TOO_MANY_REQUESTS");
    });

    it("POST /user/link-email IP-level rate limit logs a warning console when threshold is crossed", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => null);

        // Configure mock checkRateLimit to trigger warning limit (Case: user limit is fine, IP limit is hit)
        mockRateLimitResult = { limited: false, remaining: 5, retryAfter: 3600 };
        mockIpLimitResult = { limited: true, remaining: 0, retryAfter: 3600 };

        const originalWarn = console.warn;
        let loggedMsg = "";
        console.warn = mock((msg: string) => {
            loggedMsg = msg;
        });

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-real-ip": "12.34.56.78",
                },
                body: JSON.stringify({ email: "user.ipwarn@example.com" }),
            })
        );
        expect(res.status).toBe(200); // Does not block
        expect(loggedMsg).toContain(
            "[Rate Limit Warning] Suspicious IP-level email linking activity detected from IP: 12.34.56.78"
        );

        console.warn = originalWarn;
    });

    it("POST /user/link-email IP-level hard rate limit returns silent 200 and skips email sending", async () => {
        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => null);

        // Configure mock checkRateLimit to trigger hard block limit
        mockRateLimitResult = { limited: false, remaining: 5, retryAfter: 3600 };
        mockIpLimitResult = { limited: true, remaining: 0, retryAfter: 3600 };
        mockIpHardLimitResult = { limited: true, remaining: 0, retryAfter: 3600 };
        dbInsertCalled = false;

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-real-ip": "12.34.56.78",
                },
                body: JSON.stringify({ email: "user.ipblock@example.com" }),
            })
        );
        expect(res.status).toBe(200); // Silent success (HTTP 200)
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbInsertCalled).toBe(false); // DB insert skipped
    });

    it("POST /user/link-email rejects when user has reached 5 total email addresses", async () => {
        mockUser.email = "user@example.com"; // real email -> counts as 1
        mockSecondaryEmails = [
            { email: "sec1@example.com", verified: true, userId: "test_user_id" },
            { email: "sec2@example.com", verified: true, userId: "test_user_id" },
            { email: "sec3@example.com", verified: false, userId: "test_user_id" },
            { email: "sec4@example.com", verified: false, userId: "test_user_id" },
        ]; // 4 secondaries -> total = 5

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "sec5@example.com" }),
            })
        );
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.code).toBe("TOO_MANY_EMAILS");
        expect(data.error.message).toBe(
            "You have reached the maximum limit of linked email addresses."
        );
    });

    it("POST /user/link-email allows resending verification if email is already in the list, even if total is 5", async () => {
        mockUser.email = "user@example.com"; // real email -> counts as 1
        mockSecondaryEmails = [
            { email: "sec1@example.com", verified: true, userId: "test_user_id" },
            { email: "sec2@example.com", verified: true, userId: "test_user_id" },
            { email: "sec3@example.com", verified: false, userId: "test_user_id" },
            { email: "sec4@example.com", verified: false, userId: "test_user_id" }, // total = 5, but sec4 is already in the list and unverified
        ];

        mockFindFirstUser.mockImplementation(async () => null);
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_id_4",
            userId: "test_user_id",
            email: "sec4@example.com",
            verified: false,
            createdAt: new Date(),
        }));

        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/link-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "sec4@example.com" }),
            })
        );
        // Should not reject with TOO_MANY_EMAILS because the email is already in the list.
        expect(res.status).not.toBe(400);
    });

    describe("POST /user/unlink-secondary-email", () => {
        it("allows unlinking an unverified secondary email directly and deletes link OTP from Redis", async () => {
            mockSecondaryEmails = [
                { email: "unverified@example.com", verified: false, userId: "test_user_id" },
            ];
            mockFindFirstUserEmails.mockImplementation(async () => ({
                id: "sec_id_unverified",
                userId: "test_user_id",
                email: "unverified@example.com",
                verified: false,
                createdAt: new Date(),
            }));

            // Seed pending OTP in Redis
            const key = RedisKeys.linkEmailOtp("test_user_id", "unverified@example.com");
            redisHashStore.set(key, new Map([["code", "123456"]]));

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-secondary-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "unverified@example.com" }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(redisHashStore.has(key)).toBe(false); // Link OTP deleted
        });

        it("fails unlinking a verified secondary email if sensitive action is not verified in Redis", async () => {
            mockSecondaryEmails = [
                { email: "verified@example.com", verified: true, userId: "test_user_id" },
            ];
            mockFindFirstUserEmails.mockImplementation(async () => ({
                id: "sec_id_verified",
                userId: "test_user_id",
                email: "verified@example.com",
                verified: true,
                createdAt: new Date(),
            }));

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-secondary-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "verified@example.com" }),
                })
            );
            expect(res.status).toBe(401);
            const data = await res.json();
            expect(data.error.code).toBe("VERIFICATION_REQUIRED");
        });

        it("succeeds unlinking a verified secondary email if sensitive action is verified in Redis", async () => {
            mockSecondaryEmails = [
                { email: "verified@example.com", verified: true, userId: "test_user_id" },
            ];
            mockFindFirstUserEmails.mockImplementation(async () => ({
                id: "sec_id_verified",
                userId: "test_user_id",
                email: "verified@example.com",
                verified: true,
                createdAt: new Date(),
            }));

            // Seed verified key in Redis
            const verifiedKey = RedisKeys.sensitiveActionVerified(
                "test_user_id",
                "unlink-secondary-email",
                "verified@example.com"
            );
            redisStore.set(verifiedKey, "verified");

            const app = await buildApp();
            const res = await app.handle(
                new Request("http://localhost/user/unlink-secondary-email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: "verified@example.com" }),
                })
            );
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(redisStore.has(verifiedKey)).toBe(false); // Key cleared
        });
    });
});
