import { describe, it, expect } from "bun:test";
import { WuWaTrackerJsonParser } from "./wuwa-tracker-json";

describe("WuWaTrackerJsonParser", () => {
    const parser = new WuWaTrackerJsonParser();

    it("should correctly parse and map a valid WuWaTracker export JSON", async () => {
        const mockExport = {
            siteVersion: "v4.7.5",
            version: "0.0.2",
            date: "2026-03-29T18:49:08.095Z",
            playerId: "123456789",
            pulls: [
                {
                    cardPoolType: 1,
                    resourceId: 21020013, // 8-digit ID -> Weapon
                    qualityLevel: 3,
                    name: "Sword of Night",
                    time: "2026-02-05T14:03:09+00:00",
                    isSorted: true,
                    group: 2, // Newest of the two pulls in the group
                },
                {
                    cardPoolType: 1,
                    resourceId: 1205, // 4-digit ID -> Resonator
                    qualityLevel: 5,
                    name: "Changli",
                    time: "2026-02-05T14:03:09+00:00",
                    isSorted: true,
                    group: 1, // Oldest of the two pulls in the group
                },
            ],
        };

        const buffer = Buffer.from(JSON.stringify(mockExport), "utf-8");
        const result = await parser.parse(buffer);

        expect(result.games).toHaveLength(1);
        const game = result.games[0];
        expect(game.gameId).toBe("wuwa");
        expect(game.gameUid).toBe("123456789");

        // Verify that the parser reversed the pulls to chronological order (oldest first)
        expect(game.pulls).toHaveLength(2);

        // Changli (group 1) was listed second in mockExport (newest-first).
        // Chronological order means Changli comes first.
        const pull1 = game.pulls[0];
        expect(pull1.itemName).toBe("Changli");
        expect(pull1.itemId).toBe("1205");
        expect(pull1.itemType).toBe("Resonator"); // 4-digit convention
        expect(pull1.rarity).toBe(5);
        expect(pull1.bannerType).toBe("1");
        expect(pull1.pulledAt.toISOString()).toBe("2026-02-05T14:03:09.000Z");
        // pullId: {playerId}_{bannerType}_{cleanTime}_{group - 1}
        expect(pull1.pullId).toBe("123456789_1_2026-02-05-14-03-09_0");

        // Sword of Night (group 2) comes second
        const pull2 = game.pulls[1];
        expect(pull2.itemName).toBe("Sword of Night");
        expect(pull2.itemId).toBe("21020013");
        expect(pull2.itemType).toBe("Weapon"); // 8-digit convention
        expect(pull2.rarity).toBe(3);
        expect(pull2.bannerType).toBe("1");
        expect(pull2.pullId).toBe("123456789_1_2026-02-05-14-03-09_1");
    });

    it("should throw an error for invalid date formats", async () => {
        const mockExport = {
            playerId: "123456789",
            pulls: [
                {
                    cardPoolType: 1,
                    resourceId: 1205,
                    qualityLevel: 5,
                    name: "Changli",
                    time: "not-a-date",
                    group: 1,
                },
            ],
        };

        const buffer = Buffer.from(JSON.stringify(mockExport), "utf-8");
        expect(parser.parse(buffer)).rejects.toThrow();
    });

    it("should throw a validation error for missing required fields", async () => {
        const mockExport = {
            // Missing playerId
            pulls: [
                {
                    cardPoolType: 1,
                    resourceId: 1205,
                    qualityLevel: 5,
                    name: "Changli",
                    time: "2026-02-05T14:03:09+00:00",
                    group: 1,
                },
            ],
        };

        const buffer = Buffer.from(JSON.stringify(mockExport), "utf-8");
        expect(parser.parse(buffer)).rejects.toThrow();
    });

    it("should throw an error for duplicate pullId collisions (repeated group index at same timestamp)", async () => {
        const mockExport = {
            playerId: "123456789",
            pulls: [
                {
                    cardPoolType: 1,
                    resourceId: 1205,
                    qualityLevel: 5,
                    name: "Changli",
                    time: "2026-02-05T14:03:09+00:00",
                    group: 1, // Duplicate group index
                },
                {
                    cardPoolType: 1,
                    resourceId: 21020013,
                    qualityLevel: 3,
                    name: "Sword of Night",
                    time: "2026-02-05T14:03:09+00:00",
                    group: 1, // Duplicate group index
                },
            ],
        };

        const buffer = Buffer.from(JSON.stringify(mockExport), "utf-8");
        expect(parser.parse(buffer)).rejects.toThrow("Duplicate pullId collision detected");
    });
});
