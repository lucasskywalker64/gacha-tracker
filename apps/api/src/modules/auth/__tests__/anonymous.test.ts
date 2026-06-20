import { describe, it, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";

const redisStore = new Map<string, string>();

const redisMock = {
    get: mock(async (key: string) => redisStore.get(key) ?? null),
    set: mock(async (key: string) => {
        redisStore.set(key, "1");
        return "OK";
    }),
    exists: mock(async (key: string) => (redisStore.has(key) ? 1 : 0)),
    getdel: mock(async (key: string) => {
        const value = redisStore.get(key) ?? null;
        if (value) redisStore.delete(key);
        return value;
    }),
    incr: mock(async (key: string) => {
        const current = redisStore.get(key);
        const count = current ? parseInt(current, 10) + 1 : 1;
        redisStore.set(key, count.toString());
        return count;
    }),
    expire: mock(async () => 1),
    ttl: mock(async () => 60),
};

const dbUsers: Array<{
    id: string;
    email: string;
    codeHash: string | null;
    isAnonymous: boolean;
}> = [];

const flagsMock = { anonymousAccounts: true };

let originalAuth: typeof import("../auth");

beforeAll(async () => {
    mock.module("../../../lib/redis", () => ({ redis: redisMock }));

    mock.module("../../../db/client", () => ({
        db: {
            query: {
                user: {
                    findFirst: mock(async () => null),
                    findMany: mock(async () => dbUsers.filter((u) => u.isAnonymous)),
                },
                verification: {
                    findFirst: mock(async () => null),
                    findMany: mock(async () => []),
                },
            },
            update: mock(() => ({
                set: mock(() => ({ where: mock(async () => undefined) })),
            })),
            insert: mock(() => ({
                values: mock(async () => undefined),
            })),
        },
    }));

    mock.module("../../../config/flags", () => ({
        getFlags: mock(async () => flagsMock),
    }));

    mock.module("../../../config", () => ({
        config: {
            BETTER_AUTH_URL: "http://localhost:3000",
            BETTER_AUTH_SECRET: "test",
        },
        ANON_PENDING_TTL_SECONDS: 300,
        IMPORT_TOKEN_TTL_SECONDS: 900,
    }));

    originalAuth = await import("../auth");

    mock.module("../auth", () => ({
        ...originalAuth,
        getUserAuthMethodsCount: mock(async () => ({
            primaryEmail: "anon@example.com",
            secondaryEmails: [],
            socialAccounts: [],
            hasAnonymousCode: true,
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
                signUpEmail: mock(async (opts: { body: { email: string } }) => {
                    const data = {
                        user: {
                            id: `user_${Date.now()}`,
                            email: opts.body.email,
                            name: "Anonymous User",
                        },
                        session: {
                            token: "test_session_token",
                            expiresAt: new Date(Date.now() + 100000),
                        },
                    };
                    return new Response(JSON.stringify(data), {
                        headers: {
                            "set-cookie":
                                "better-auth.session_token=test_signed_token; Path=/; HttpOnly",
                        },
                    });
                }),
                signInEmail: mock(async () => ({ user: null, session: null })),
            },
        },
    }));
});

afterAll(() => {
    if (originalAuth) {
        mock.module("../auth", () => originalAuth);
    }
});

async function buildApp() {
    const { anonymousAuthPlugin } = await import("../anonymous");
    return new Elysia().use(anonymousAuthPlugin);
}

function makeRequest(path: string, body?: unknown) {
    return new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
}

describe("anonymousAuthPlugin — /generate", () => {
    beforeEach(() => {
        redisStore.clear();
        flagsMock.anonymousAccounts = true;
        redisMock.get.mockReset();
        redisMock.set.mockReset();
        redisMock.exists.mockReset();
        redisMock.exists.mockImplementation(
            async (key: string) => (redisStore.has(key) ? 1 : 0) as 0 | 1
        );
        redisMock.set.mockImplementation(async (key: string) => {
            redisStore.set(key, "1");
            return "OK";
        });
    });

    it("returns 403 when anonymousAccounts flag is disabled", async () => {
        flagsMock.anonymousAccounts = false;
        const app = await buildApp();
        const res = await app.handle(makeRequest("/anonymous/generate"));
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe("ANONYMOUS_ACCOUNTS_DISABLED");
    });

    it("returns a 16-character code and stores a Redis key", async () => {
        const app = await buildApp();
        const res = await app.handle(makeRequest("/anonymous/generate"));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.code).toBe("string");
        expect(body.code.length).toBe(16);
        expect(redisMock.set.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
});

describe("anonymousAuthPlugin — /confirm", () => {
    beforeEach(() => {
        redisStore.clear();
        redisMock.getdel.mockReset();
        redisMock.getdel.mockImplementation(async (key: string) => {
            const value = redisStore.get(key) ?? null;
            if (value) redisStore.delete(key);
            return value;
        });
    });

    it("returns 400 when the code key is not in Redis (expired or never issued)", async () => {
        const app = await buildApp();
        const res = await app.handle(
            makeRequest("/anonymous/confirm", { code: "AAAAAAAAAAAAAAAA" })
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("INVALID_OR_EXPIRED_CODE");
    });

    it("returns 400 on double-confirm (key already consumed)", async () => {
        let callCount = 0;
        redisMock.getdel.mockImplementation(async () => {
            callCount++;
            return callCount === 1 ? "1" : null;
        });

        const app = await buildApp();

        const firstRes = await app.handle(
            makeRequest("/anonymous/confirm", { code: "BBBBBBBBBBBBBBBB" })
        );
        expect(firstRes.status).toBe(200);

        const secondRes = await app.handle(
            makeRequest("/anonymous/confirm", { code: "BBBBBBBBBBBBBBBB" })
        );
        expect(secondRes.status).toBe(400);
        const body = await secondRes.json();
        expect(body.error.code).toBe("INVALID_OR_EXPIRED_CODE");
    });

    it("creates an account successfully when the code key exists in Redis", async () => {
        redisMock.getdel.mockResolvedValueOnce("1");

        const app = await buildApp();
        const res = await app.handle(
            makeRequest("/anonymous/confirm", { code: "CCCCCCCCCCCCCCCC" })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.userId).toBe("string");
    });
});

describe("anonymousAuthPlugin — Rate Limiting", () => {
    beforeEach(() => {
        redisStore.clear();
        redisMock.get.mockReset();
        redisMock.incr.mockReset();
        redisMock.get.mockImplementation(async (key: string) => redisStore.get(key) ?? null);
        redisMock.incr.mockImplementation(async (key: string) => {
            const current = redisStore.get(key);
            const count = current ? parseInt(current, 10) + 1 : 1;
            redisStore.set(key, count.toString());
            return count;
        });
    });

    it("enforces rate limits on /anonymous/generate", async () => {
        const app = await buildApp();

        // Send 5 successful requests
        for (let i = 0; i < 5; i++) {
            const res = await app.handle(makeRequest("/anonymous/generate"));
            expect(res.status).toBe(200);
        }

        // The 6th request must trigger a 429 Too Many Requests
        const blockedRes = await app.handle(makeRequest("/anonymous/generate"));
        expect(blockedRes.status).toBe(429);
        const body = await blockedRes.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    });
});
