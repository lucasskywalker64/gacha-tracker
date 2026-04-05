import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";

const redisStore = new Map<string, string>();

const redisMock = {
    get: mock(async (key: string) => redisStore.get(key) ?? null),
    set: mock(async (key: string) => {
        redisStore.set(key, "1");
        return "OK";
    }),
    exists: mock(async (key: string) => (redisStore.has(key) ? 1 : 0)),
    eval: mock(async (_script: string, _numKeys: number, key: string) => {
        const value = redisStore.get(key) ?? null;
        if (value) redisStore.delete(key);
        return value;
    }),
};

mock.module("../../../lib/redis", () => ({ redis: redisMock }));

const dbUsers: Array<{
    id: string;
    email: string;
    codeHash: string | null;
    isAnonymous: boolean;
    deletedAt: number | null;
}> = [];

mock.module("../../../db/client", () => ({
    db: {
        query: {
            users: {
                findFirst: mock(async () => null),
                findMany: mock(async () => dbUsers.filter((u) => u.isAnonymous)),
            },
        },
        update: mock(() => ({
            set: mock(() => ({ where: mock(async () => undefined) })),
        })),
    },
}));

const flagsMock = { anonymousAccounts: true };
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

mock.module("../auth", () => ({
    auth: {
        api: {
            signUpEmail: mock(async (opts: { body: { email: string } }) => ({
                user: {
                    id: `user_${Date.now()}`,
                    email: opts.body.email,
                    name: "Anonymous User",
                },
                session: null,
            })),
            signInEmail: mock(async () => ({ user: null, session: null })),
        },
    },
}));

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
        const res = await app.handle(makeRequest("/api/auth/anonymous/generate"));
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error.code).toBe("ANONYMOUS_ACCOUNTS_DISABLED");
    });

    it("returns a 16-character code and stores a Redis key", async () => {
        const app = await buildApp();
        const res = await app.handle(makeRequest("/api/auth/anonymous/generate"));
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
        redisMock.eval.mockReset();
        redisMock.eval.mockImplementation(
            async (_script: string, _numKeys: number, key: string) => {
                const value = redisStore.get(key) ?? null;
                if (value) redisStore.delete(key);
                return value;
            }
        );
    });

    it("returns 400 when the code key is not in Redis (expired or never issued)", async () => {
        const app = await buildApp();
        const res = await app.handle(
            makeRequest("/api/auth/anonymous/confirm", { code: "AAAAAAAAAAAAAAAA" })
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error.code).toBe("INVALID_OR_EXPIRED_CODE");
    });

    it("returns 400 on double-confirm (key already consumed)", async () => {
        let callCount = 0;
        redisMock.eval.mockImplementation(async () => {
            callCount++;
            return callCount === 1 ? "1" : null;
        });

        const app = await buildApp();

        const firstRes = await app.handle(
            makeRequest("/api/auth/anonymous/confirm", { code: "BBBBBBBBBBBBBBBB" })
        );
        expect(firstRes.status).toBe(200);

        const secondRes = await app.handle(
            makeRequest("/api/auth/anonymous/confirm", { code: "BBBBBBBBBBBBBBBB" })
        );
        expect(secondRes.status).toBe(400);
        const body = await secondRes.json();
        expect(body.error.code).toBe("INVALID_OR_EXPIRED_CODE");
    });

    it("creates an account successfully when the code key exists in Redis", async () => {
        redisMock.eval.mockResolvedValueOnce("1");

        const app = await buildApp();
        const res = await app.handle(
            makeRequest("/api/auth/anonymous/confirm", { code: "CCCCCCCCCCCCCCCC" })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.userId).toBe("string");
    });
});
