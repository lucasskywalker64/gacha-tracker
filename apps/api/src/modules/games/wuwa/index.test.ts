import { describe, it, expect, beforeEach } from "bun:test";
import { wuwaAdapter } from "./index";
import { type NormalizedPull, banners } from "@gacha-tracker/shared";

describe("Wuthering Waves Game Adapter", () => {
    describe("normalizeImport", () => {
        it("should correctly normalize pulls", async () => {
            const rawPayload = {
                gameId: "wuwa",
                gameUid: "123",
                pulls: [
                    {
                        pullId: "eebf2390a3b211efb4486b72a6b22591",
                        bannerType: "1",
                        itemId: "1205", // Changli
                        itemName: "Unknown",
                        itemType: "Resonator",
                        rarity: 5,
                        pulledAt: new Date().toISOString(),
                    },
                ],
            };

            const result = await wuwaAdapter.normalizeImport(rawPayload);
            expect(result.pulls[0].pullId).toBe("eebf2390a3b211efb4486b72a6b22591");
            expect(result.pulls[0].itemId).toBe("1205");
            expect(result.pulls[0].rarity).toBe(5);
            expect(result.pulls[0].bannerType).toBe("1");
        });
    });

    describe("computePity", () => {
        beforeEach(() => {
            banners.games.wuwa = [
                {
                    phase: "Test_Phase_1",
                    name: "Test Banner",
                    featuredCharacters: ["1304", "1205"], // 1304 is Jinhsi, 1205 is Changli (concurrent)
                    mainCharacterId: "1304",
                    featuredWeapons: ["21040021"], // Ages of Harvest
                    mainWeaponId: "21040021",
                    startTime: 0,
                    endTime: 10,
                },
            ];
        });

        it("should correctly increment pity for 3-star pulls", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21020013",
                    itemName: "Sword#18",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = wuwaAdapter.computePity(pulls, "1");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0);

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[1].wasGuaranteed).toBe(0);
        });

        it("should correctly reset pity and set guarantee after losing the 50/50", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1503", // Verina
                    itemName: "Verina",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1304", // Jinhsi
                    itemName: "Jinhsi",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(3),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = wuwaAdapter.computePity(pulls, "1");

            // First 5-star (Lost 50/50)
            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0);

            // 3-star after reset
            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(1);

            // Second 5-star (Won via guarantee)
            expect(processed[2].pityAtPull).toBe(2);
            expect(processed[2].wasGuaranteed).toBe(1);
        });

        it("should correctly identify a won 50/50 and not set the next character to guaranteed", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1304",
                    itemName: "Jinhsi",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1304",
                    itemName: "Jinhsi",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = wuwaAdapter.computePity(pulls, "1");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[0].bannerId).toBe("1304");

            expect(processed[1].pityAtPull).toBe(1);
            expect(processed[1].wasGuaranteed).toBe(0);
            expect(processed[1].bannerId).toBe("1304");
        });

        it("should correctly attribute pulls using 5-star approximation", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1205", // Changli
                    itemName: "Changli",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = wuwaAdapter.computePity(pulls, "1");
            expect(processed[0].bannerId).toBe("1205");
            expect(processed[1].bannerId).toBe("1205");
        });

        it("should fallback to mainCharacterId on lost 50/50 or incomplete sequence", () => {
            const pulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "1503", // Verina
                    itemName: "Verina",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = wuwaAdapter.computePity(pulls, "1");
            // Sequence 1 ends in a 5-star loss
            expect(processed[0].bannerId).toBe("1304");
            // Sequence 2 is incomplete (ends at the end of the array without a 5-star)
            expect(processed[1].bannerId).toBe("1304");
        });

        it("should maintain independent pity between different banner types", () => {
            const characterPulls: NormalizedPull[] = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: "1",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
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
                    bannerType: "3",
                    itemId: "21010012",
                    itemName: "Broadblade#41",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: "3",
                    itemId: "21020013",
                    itemName: "Sword#18",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(3),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processedChar = wuwaAdapter.computePity(characterPulls, "1");
            const processedStandard = wuwaAdapter.computePity(standardPulls, "3");

            expect(processedChar[0].pityAtPull).toBe(1);
            expect(processedStandard[1].pityAtPull).toBe(2);
        });

        it("should correctly handle collab character (10) and collab weapon (11) banners", () => {
            banners.games.wuwa = [
                {
                    phase: "Collab_Phase",
                    name: "Lucy Banner",
                    featuredCharacters: ["1511"], // Lucy
                    mainCharacterId: "1511",
                    featuredWeapons: ["21030056"], // Spectral Trigger
                    mainWeaponId: "21030056",
                    startTime: 0,
                    endTime: 10,
                },
            ];

            const collabCharPulls: NormalizedPull[] = [
                {
                    pullId: "collab-c1",
                    gameUid: "123",
                    bannerType: "10",
                    itemId: "1503", // Verina (standard character)
                    itemName: "Verina",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "collab-c2",
                    gameUid: "123",
                    bannerType: "10",
                    itemId: "1511", // Lucy (collab featured character)
                    itemName: "Lucy",
                    itemType: "Resonator",
                    rarity: 5,
                    pulledAt: new Date(2),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processedCollabChar = wuwaAdapter.computePity(collabCharPulls, "10");
            // Lost 50/50 on first pull
            expect(processedCollabChar[0].pityAtPull).toBe(1);
            expect(processedCollabChar[0].wasGuaranteed).toBe(0);
            expect(processedCollabChar[0].bannerId).toBe("1511");

            // Won featured on second pull due to guarantee
            expect(processedCollabChar[1].pityAtPull).toBe(1);
            expect(processedCollabChar[1].wasGuaranteed).toBe(1);
            expect(processedCollabChar[1].bannerId).toBe("1511");

            const collabWeapPulls: NormalizedPull[] = [
                {
                    pullId: "collab-w1",
                    gameUid: "123",
                    bannerType: "11",
                    itemId: "21030056", // Spectral Trigger (collab featured weapon)
                    itemName: "Spectral Trigger",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processedCollabWeap = wuwaAdapter.computePity(collabWeapPulls, "11");
            expect(processedCollabWeap[0].pityAtPull).toBe(1);
            expect(processedCollabWeap[0].wasGuaranteed).toBe(0);
            expect(processedCollabWeap[0].bannerId).toBe("21030056");
        });
    });
});
