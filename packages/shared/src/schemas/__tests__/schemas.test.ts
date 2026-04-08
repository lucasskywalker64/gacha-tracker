import { describe, it, expect } from "bun:test";
import { importPayloadSchema, paginationSchema, rawPullSchema } from "../index";

describe("Shared Schemas", () => {
    describe("paginationSchema", () => {
        it("validates valid pagination requests", () => {
            const result = paginationSchema.safeParse({
                gameId: "starrail",
                page: "2", // Should coerce to number
                limit: "20",
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.page).toBe(2);
                expect(result.data.limit).toBe(20);
            }
        });

        it("defaults correctly", () => {
            const result = paginationSchema.safeParse({ gameId: "genshin" });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.page).toBe(1);
                expect(result.data.limit).toBe(50);
            }
        });

        it("rejects unknown gameIds", () => {
            const result = paginationSchema.safeParse({
                gameId: "fakegame",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("rawPullSchema", () => {
        it("validates a proper raw pull", () => {
            const result = rawPullSchema.safeParse({
                pullId: "123456",
                bannerType: "11",
                itemId: "1001",
                itemName: "Seele",
                itemType: "Character",
                rarity: 5,
                pulledAt: "2023-05-01 12:00:00",
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing mandatory fields", () => {
            const result = rawPullSchema.safeParse({
                pullId: "123456",
            });
            expect(result.success).toBe(false);
        });
    });

    describe("importPayloadSchema", () => {
        it("validates a full payload", () => {
            const result = importPayloadSchema.safeParse({
                gameId: "zzz",
                gameUid: "100001",
                pulls: [
                    {
                        pullId: "1",
                        bannerType: "1",
                        itemId: "1",
                        itemName: "Ellen",
                        itemType: "Agent",
                        rarity: 5,
                        pulledAt: "2024-07-04",
                    },
                ],
            });
            expect(result.success).toBe(true);
        });
    });
});
