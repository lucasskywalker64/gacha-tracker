import { describe, it, expect } from "bun:test";
import { hsrAdapter } from "./index";
import { type NormalizedPull } from "@gacha-tracker/shared";

describe("Honkai: Star Rail Game Adapter", () => {
    describe("computePity", () => {
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(false);

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[1].wasGuaranteed).toBe(false);
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            // First 5-star (Lost 50/50)
            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(false); // First one wasn't guaranteed

            // 3-star after reset
            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(true); // Banner is in guaranteed state

            // Second 5-star (Won via guarantee)
            expect(processed[2].pityAtPull).toBe(2);
            expect(processed[2].wasGuaranteed).toBe(true); // Should be guaranteed
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
                },
            ];

            const processed = adapter.computePity(pulls, "11");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(false); // Won 50/50

            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(false); // Also won 50/50, but wasn't guaranteed
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
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
                    wasGuaranteed: false,
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
