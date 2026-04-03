import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Elysia } from "elysia";
import { importTokenGuard } from "../importTokenGuard";

const store = new Map<string, string>();

const redisMock = {
  eval: mock(async (_script: string, _numKeys: number, key: string) => {
    const value = store.get(key) ?? null;
    if (value) store.delete(key);
    return value;
  }),
};

mock.module("../../lib/redis", () => ({
  redis: redisMock,
}));

function buildApp() {
  return new Elysia()
    .use(importTokenGuard)
    .post("/pulls/import", ({ importUserId }) => ({
      success: true,
      userId: importUserId,
    }));
}

describe("importTokenGuard", () => {
  beforeEach(() => {
    store.clear();
    redisMock.eval.mockReset();
    redisMock.eval.mockImplementation(
      async (_script: string, _numKeys: number, key: string) => {
        const value = store.get(key) ?? null;
        if (value) store.delete(key);
        return value;
      },
    );
  });

  it("returns 401 when no Authorization header is present", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/pulls/import", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is not a Bearer token", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/pulls/import", {
        method: "POST",
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is not in Redis (expired or never issued)", async () => {
    // store is empty — Redis returns null
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/pulls/import", {
        method: "POST",
        headers: {
          Authorization: "Bearer nonexistent-token-uuid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("allows the request and resolves userId when token is valid", async () => {
    const token = "valid-token-uuid-001";
    store.set(`import_token:${token}`, "user_abc");

    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/pulls/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user_abc");
  });

  it("token is single-use — second request with same token returns 401", async () => {
    const token = "single-use-token-uuid";
    store.set(`import_token:${token}`, "user_xyz");

    const app = buildApp();

    // First request: should succeed
    const res1 = await app.handle(
      new Request("http://localhost/pulls/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res1.status).toBe(200);

    // Second request with same token: key was consumed, should be 401
    const res2 = await app.handle(
      new Request("http://localhost/pulls/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res2.status).toBe(401);
  });
});
