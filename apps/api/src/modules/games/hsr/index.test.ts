import { describe, it, expect, beforeEach } from "bun:test";
import { hsrAdapter } from "./index";
import { type NormalizedPull, banners } from "@gacha-tracker/shared";

describe("Honkai: Star Rail Game Adapter", () => {
    describe("computePity", () => {
        beforeEach(() => {
            banners.games.hsr = [
                {
                    phase: "Test_Phase_1",
                    name: "Test Banner",
                    featuredCharacters: ["202", "203"], // 202 is main, 203 is concurrent
                    mainCharacterId: "202",
                    featuredWeapons: ["23000"],
                    mainWeaponId: "23000",
                    startTime: 0,
                    endTime: 10,
                },
            ];
        });
        it("should correctly increment pity for 3-star pulls", () => {
            const adapter = hsrAdapter;
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "101",
                    itemName: "3-star LC",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "102",
                    itemName: "3-star LC",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0);

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[1].wasGuaranteed).toBe(0);
        });

        it("should correctly reset pity and set guarantee after losing the 50/50", () => {
            const adapter = hsrAdapter;
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "1003",
                    itemName: "Standard 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "101",
                    itemName: "3-star LC",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "202",
                    itemName: "Promotional 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(3),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            // First 5-star (Lost 50/50)
            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0); // First one wasn't guaranteed

            // 3-star after reset
            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(1); // Banner is in guaranteed state

            // Second 5-star (Won via guarantee)
            expect(processed[2].pityAtPull).toBe(2);
            expect(processed[2].wasGuaranteed).toBe(1); // Should be guaranteed
        });

        it("should correctly identify a won 50/50 and not set the next character to guaranteed", () => {
            const adapter = hsrAdapter;
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "202",
                    itemName: "Promotional 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "202",
                    itemName: "Promotional 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0); // Won 50/50
            expect(processed[0].bannerId).toBe("202"); // Attributed to specific 5-star pulled

            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(0); // Also won 50/50, but wasn't guaranteed
            expect(processed[1].bannerId).toBe("202");
        });

        it("should correctly attribute pulls using 5-star approximation", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "101",
                    itemName: "3-star",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "203",
                    itemName: "Concurrent 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = hsrAdapter.computePity(pulls, "11");
            expect(processed[0].bannerId).toBe("203");
            expect(processed[1].bannerId).toBe("203");
        });

        it("should fallback to mainCharacterId on lost 50/50 or incomplete sequence", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "1003",
                    itemName: "Standard 5-star",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "101",
                    itemName: "3-star",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = hsrAdapter.computePity(pulls, "11");
            // Sequence 1 ends in a 5-star loss
            expect(processed[0].bannerId).toBe("202");
            // Sequence 2 is incomplete (ends at the end of the array without a 5-star)
            expect(processed[1].bannerId).toBe("202");
        });

        it("should maintain independent pity between different banner types", () => {
            const adapter = hsrAdapter;
            const characterPulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "101",
                    itemName: "3-star",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const standardPulls: NormalizedPull[] = [
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "101",
                    itemName: "3-star",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "101",
                    itemName: "3-star",
                    itemType: "Light Cone",
                    rarity: 3,
                    pulledAt: new Date(3),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            // Note: computePity expects pulls from a single banner type at a time.
            const processedChar = adapter.computePity(characterPulls, "11");
            const processedStandard = adapter.computePity(standardPulls, "1");

            expect(processedChar[0].pityAtPull).toBe(1);
            expect(processedStandard[1].pityAtPull).toBe(2);
        });
    });
});
