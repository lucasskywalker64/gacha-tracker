import { describe, it, expect, beforeEach, mock } from "bun:test";

const redisStore = new Map<string, string>();

const redisMock = {
    get: mock(async (key: string) => redisStore.get(key) ?? null),
    set: mock(async (key: string, value: string) => {
        redisStore.set(key, value);
        return "OK";
    }),
    del: mock(async (key: string) => {
        redisStore.delete(key);
        return 1;
    }),
};

mock.module("../../lib/redis", () => ({ redis: redisMock }));

const dbRows: Array<{ key: string; enabled: number }> = [];

const dbMock = {
    select: mock(() => ({
        from: mock(async () => dbRows),
    })),
};

mock.module("../../db/client", () => ({
    db: dbMock,
}));

describe("Feature Flags", () => {
    beforeEach(() => {
        redisStore.clear();
        dbRows.length = 0;
        redisMock.get.mockClear();
        redisMock.set.mockClear();
        redisMock.del.mockClear();
        dbMock.select.mockClear();
    });

    it("should return fallback defaults when Redis and DB are empty (cache miss)", async () => {
        const { getFlags } = await import("../flags");
        const flags = await getFlags();

        expect(flags).toEqual({
            starrail: true,
            genshin: true,
            zzz: true,
            wuwa: true,
            anonymousAccounts: true,
            experimentalLuckScore: false,
        });

        // Should have queried DB since Redis is empty
        expect(dbMock.select).toHaveBeenCalled();

        // Should have updated Redis cache with the default flags
        expect(redisMock.set).toHaveBeenCalledWith(
            "flags",
            JSON.stringify({
                starrail: true,
                genshin: true,
                zzz: true,
                wuwa: true,
                anonymousAccounts: true,
                experimentalLuckScore: false,
            })
        );
    });

    it("should use values from database on cache miss and warm cache", async () => {
        const { getFlags } = await import("../flags");
        dbRows.push({ key: "starrail", enabled: 0 }, { key: "experimentalLuckScore", enabled: 1 });

        const flags = await getFlags();

        expect(flags).toEqual({
            starrail: false, // overridden by DB
            genshin: true, // fallback
            zzz: true, // fallback
            wuwa: true, // fallback
            anonymousAccounts: true, // fallback
            experimentalLuckScore: true, // overridden by DB
        });

        expect(dbMock.select).toHaveBeenCalled();
        expect(redisMock.set).toHaveBeenCalledWith("flags", JSON.stringify(flags));
    });

    it("should return cached values on cache hit and not query the DB", async () => {
        const { getFlags } = await import("../flags");
        const cachedFlags = {
            starrail: false,
            genshin: false,
            zzz: false,
            wuwa: false,
            anonymousAccounts: false,
            experimentalLuckScore: true,
        };
        redisStore.set("flags", JSON.stringify(cachedFlags));

        const flags = await getFlags();

        expect(flags).toEqual(cachedFlags);
        expect(redisMock.get).toHaveBeenCalledWith("flags");
        expect(dbMock.select).not.toHaveBeenCalled();
    });

    it("should invalidate the cache successfully", async () => {
        const { invalidateFlags } = await import("../flags");
        redisStore.set("flags", "some-cached-data");

        await invalidateFlags();

        expect(redisMock.del).toHaveBeenCalledWith("flags");
        expect(redisStore.has("flags")).toBe(false);
    });

    it("should fallback to defaults if Redis has invalid/corrupted data", async () => {
        const { getFlags } = await import("../flags");
        redisStore.set("flags", "invalid-json-string{");

        const flags = await getFlags();

        expect(flags).toEqual({
            starrail: true,
            genshin: true,
            zzz: true,
            wuwa: true,
            anonymousAccounts: true,
            experimentalLuckScore: false,
        });

        // Since parsing failed, it should query the DB and update the cache
        expect(dbMock.select).toHaveBeenCalled();
        expect(redisMock.set).toHaveBeenCalled();
    });
});
