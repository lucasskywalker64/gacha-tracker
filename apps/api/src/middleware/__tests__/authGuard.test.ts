import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";

const mockGetSession = mock(async () => null as unknown);

mock.module("../../modules/auth/auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

mock.module("../../lib/redis", () => ({
  redis: {
    ping: mock(async () => "PONG"),
    get: mock(async () => null),
    set: mock(async () => "OK"),
    del: mock(async () => 1),
  },
}));

mock.module("../../db/client", () => ({
  db: {
    run: mock(async () => undefined),
    query: { users: { findMany: mock(async () => []) } },
  },
}));

async function buildApp() {
  const { authGuard } = await import("../authGuard");
  return new Elysia()
    .use(authGuard)
    .get("/protected", ({ user }) => ({ userId: user.id }));
}

describe("authGuard", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(async () => null as unknown);
  });

  it("returns 401 when no session cookie is present", async () => {
    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/protected"),
    );
    expect(res.status).toBe(401);
  });

  it("allows the request and attaches user when session is valid", async () => {
    const fakeUser = {
      id: "user_123",
      name: "Test User",
      email: "test@example.com",
      emailVerified: true,
      image: null,
      deletedAt: null,
      isAnonymous: false,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const fakeSession = {
      id: "session_abc",
      userId: "user_123",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      token: "tok",
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetSession.mockImplementation(async () => ({ user: fakeUser, session: fakeSession }) as any);

    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Cookie: "better-auth.session=valid-session-token" },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user_123");
  });

  it("returns 401 for a soft-deleted user", async () => {
    const fakeUser = {
      id: "user_deleted",
      name: "Deleted",
      email: "deleted@example.com",
      emailVerified: true,
      image: null,
      deletedAt: Math.floor(Date.now() / 1000) - 3600,
      isAnonymous: false,
      isAdmin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const fakeSession = {
      id: "session_del",
      userId: "user_deleted",
      expiresAt: new Date(Date.now() + 3600 * 1000),
      token: "tok",
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetSession.mockImplementation(async () => ({ user: fakeUser, session: fakeSession }) as any);

    const app = await buildApp();
    const res = await app.handle(
      new Request("http://localhost/protected", {
        headers: { Cookie: "better-auth.session=deleted-user-token" },
      }),
    );

    expect(res.status).toBe(401);
  });
});
