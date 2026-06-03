import { describe, it, expect, beforeEach, beforeAll, afterAll, mock } from "bun:test";
import { Elysia } from "elysia";

// 1. Mock DB queries & updates
const mockSettings = {
    userId: "test_user_id",
    theme: "quantum-dark",
    pityDisplayMode: "count_up",
    updatedAt: new Date(),
};

let dbDeleteCalledWith: unknown = null;
let dbUpdateCalledWith: Record<string, unknown> | null = null;

mock.module("../../../db/client", () => ({
    db: {
        query: {
            userSettings: {
                findFirst: mock(async () => mockSettings),
            },
        },
        insert: mock(() => ({
            values: mock(async () => {
                return undefined;
            }),
        })),
        update: mock(() => ({
            set: mock((vals: Record<string, unknown>) => {
                dbUpdateCalledWith = vals;
                return {
                    where: mock(async () => undefined),
                };
            }),
        })),
        delete: mock((table: unknown) => {
            dbDeleteCalledWith = table;
            return {
                where: mock(async () => undefined),
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
                    delete: mock((table: unknown) => {
                        dbDeleteCalledWith = table;
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
    return new Elysia().use(userRouter);
}

describe("userRouter — /settings", () => {
    beforeEach(() => {
        dbDeleteCalledWith = null;
        dbUpdateCalledWith = null;
        mockRevokeSessions.mockClear();
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
});

describe("userRouter — /export", () => {
    it("GET /user/export returns aggregated pulls", async () => {
        const app = await buildApp();
        const res = await app.handle(new Request("http://localhost/user/export"));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.schemaVersion).toBe("1.0.0");
        expect(data.pulls).toBeArray();
        expect(data.pulls[0].pullId).toBe("p1");
    });
});

describe("userRouter — DELETE /user/game/:gameId (Purge)", () => {
    it("deletes targeting game data cleanly", async () => {
        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user/game/hsr", {
                method: "DELETE",
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbDeleteCalledWith).toBeDefined();
    });
});

describe("userRouter — DELETE /user (Soft Delete)", () => {
    it("soft deletes the user and revokes sessions", async () => {
        const app = await buildApp();
        const res = await app.handle(
            new Request("http://localhost/user", {
                method: "DELETE",
            })
        );
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(dbUpdateCalledWith?.deletedAt).toBeDefined();
        expect(mockRevokeSessions).toHaveBeenCalledTimes(1);
    });
});
