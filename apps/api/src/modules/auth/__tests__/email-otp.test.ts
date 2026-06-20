/* eslint-disable @typescript-eslint/no-explicit-any */
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

interface VerificationRecord {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

let mockVerificationRecords: Array<VerificationRecord> = [];

const mockUser = {
    id: "test_user_id",
    name: "Test User",
    email: "user@example.com",
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const mockFindFirstUser = mock(async () => mockUser);
const mockFindFirstUserEmails = mock(async () => null as any);

mock.module("../../../db/client", () => ({
    db: {
        query: {
            user: {
                findFirst: mockFindFirstUser,
            },
            userEmails: {
                findFirst: mockFindFirstUserEmails,
            },
            verification: {
                findMany: mock(async () => [...mockVerificationRecords]),
            },
        },
        insert: mock(() => ({
            values: mock(async () => undefined),
        })),
        update: mock(() => ({
            set: mock((vals: Record<string, unknown>) => {
                return {
                    where: mock(async () => {
                        // We will update the record in mockVerificationRecords
                        // Extracting record ID is usually done, but since we are mocking, we can just update all matching identifier/ids
                        const valToSet = vals.value as string;
                        // For simplicity, update all matching records
                        mockVerificationRecords.forEach((r) => {
                            r.value = valToSet;
                            r.updatedAt = new Date();
                        });
                    }),
                };
            }),
        })),
        delete: mock(() => ({
            where: mock(async () => {
                // Clear the records
                mockVerificationRecords = [];
            }),
        })),
    },
}));

let originalAuth: typeof import("../auth");

const mockSignInEmailOTP = mock(async () => {
    const data = {
        user: mockUser,
        session: {
            token: "test_session_token",
            expiresAt: new Date(Date.now() + 100000),
        },
    };
    return new Response(JSON.stringify(data), {
        headers: {
            "set-cookie": "better-auth.session_token=test_signed_token; Path=/; HttpOnly",
        },
    });
});

beforeAll(async () => {
    mock.module("../../../lib/redis", () => ({ redis: redisMock }));

    originalAuth = await import("../auth");

    mock.module("../auth", () => ({
        ...originalAuth,
        getUserAuthMethodsCount: mock(async () => ({
            primaryEmail: "user@example.com",
            secondaryEmails: [],
            socialAccounts: [],
            hasAnonymousCode: false,
            totalActiveCount: 1,
        })),
        signJWT: () => "test_signed_token",
        verifyJWT: () => ({ userId: "test_user_id" }),
        generateSessionToken: () => "test_session_token",
        signSessionToken: async () => "test_signed_token",
        auth: {
            ...originalAuth.auth,
            api: {
                ...originalAuth.auth.api,
                signInEmailOTP: mockSignInEmailOTP,
            },
        },
    }));
});

afterAll(() => {
    if (originalAuth) {
        mock.module("../auth", () => originalAuth);
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
    const { authPlugin } = await import("../index");
    return new Elysia().use(authPlugin);
}

function makeRequest(body: unknown) {
    return new Request("http://localhost/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("authPlugin — /sign-in/email-otp Lockout", () => {
    beforeEach(() => {
        redisStore.clear();
        mockVerificationRecords = [];
        mockSignInEmailOTP.mockClear();

        mockFindFirstUserEmails.mockReset();
        mockFindFirstUserEmails.mockImplementation(async () => null as any);

        mockFindFirstUser.mockReset();
        mockFindFirstUser.mockImplementation(async () => mockUser);
    });

    it("Primary Email: successful verification on first try", async () => {
        mockVerificationRecords = [
            {
                id: "v_1",
                identifier: "sign-in-otp-user@example.com",
                value: "123456",
                expiresAt: new Date(Date.now() + 300000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const app = await buildApp();
        const res = await app.handle(makeRequest({ email: "user@example.com", otp: "123456" }));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.user.id).toBe("test_user_id");
        expect(mockSignInEmailOTP.mock.calls.length).toBe(1);
        expect(mockVerificationRecords[0].value).toBe("123456"); // remains stripped
    });

    it("Primary Email: failed verification increments attempts", async () => {
        mockVerificationRecords = [
            {
                id: "v_1",
                identifier: "sign-in-otp-user@example.com",
                value: "123456",
                expiresAt: new Date(Date.now() + 300000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const app = await buildApp();
        const res = await app.handle(makeRequest({ email: "user@example.com", otp: "wrong" }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.error.message).toBe("Invalid or expired verification code.");
        expect(mockSignInEmailOTP.mock.calls.length).toBe(0);
        expect(mockVerificationRecords[0].value).toBe("123456:1");
    });

    it("Primary Email: locked out (deleted) after 5 failed attempts", async () => {
        mockVerificationRecords = [
            {
                id: "v_1",
                identifier: "sign-in-otp-user@example.com",
                value: "123456:4",
                expiresAt: new Date(Date.now() + 300000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const app = await buildApp();
        const res = await app.handle(makeRequest({ email: "user@example.com", otp: "wrong" }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(mockSignInEmailOTP.mock.calls.length).toBe(0);
        expect(mockVerificationRecords.length).toBe(0); // record deleted
    });

    it("Primary Email: successful verification after 2 failed attempts", async () => {
        mockVerificationRecords = [
            {
                id: "v_1",
                identifier: "sign-in-otp-user@example.com",
                value: "123456:2",
                expiresAt: new Date(Date.now() + 300000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const app = await buildApp();
        const res = await app.handle(makeRequest({ email: "user@example.com", otp: "123456" }));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.user.id).toBe("test_user_id");
        expect(mockSignInEmailOTP.mock.calls.length).toBe(1);
        expect(mockVerificationRecords[0].value).toBe("123456"); // stripped for Better-Auth
    });

    it("Secondary Email: manual verification path still works and locks out properly", async () => {
        // Mock that the email is a secondary email
        mockFindFirstUserEmails.mockImplementation(async () => ({
            id: "sec_1",
            userId: "test_user_id",
            email: "secondary@example.com",
            verified: true,
        }));

        mockVerificationRecords = [
            {
                id: "v_2",
                identifier: "sign-in-otp-secondary@example.com",
                value: "654321:4",
                expiresAt: new Date(Date.now() + 300000),
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        const app = await buildApp();
        const res = await app.handle(makeRequest({ email: "secondary@example.com", otp: "wrong" }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(mockSignInEmailOTP.mock.calls.length).toBe(0);
        expect(mockVerificationRecords.length).toBe(0); // record deleted
    });
});
