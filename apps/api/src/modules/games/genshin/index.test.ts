import { describe, expect, it, beforeEach } from "bun:test";
import { genshinAdapter } from "./index";
import { banners, GENSHIN_BANNERS } from "@gacha-tracker/shared";

describe("genshinAdapter", () => {
    beforeEach(() => {
        // Mock banners for testing
        banners.games.genshin = [
            {
                phase: "1.0.1",
                name: "Venti",
                featuredCharacters: ["10000022"], // Venti
                mainCharacterId: "10000022",
                featuredWeapons: ["11501"], // Amos' Bow
                mainWeaponId: "11501",
                startTime: 1601287200000,
                endTime: 1603011600000,
            },
        ];
    });

    describe("computePity", () => {
        it("should correctly compute shared pity for Character 1 (301) and Character 2 (400)", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "1",
                    itemName: "Cool Steel",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER_2),
                    itemId: "2",
                    itemName: "Harbinger of Dawn",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "10000022",
                    itemName: "Venti",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 3000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, "limited_character");

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[2].pityAtPull).toBe(3);
            expect(processed[2].bannerId).toBe("10000022");
        });

        it("should handle 50/50 loss and guarantee correctly across shared banners", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "10000003", // Jean (Standard)
                    itemName: "Jean",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER_2),
                    itemId: "10000022", // Venti (Featured)
                    itemName: "Venti",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, "limited_character");

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(1);
            expect(processed[1].pityAtPull).toBe(1); // Reset after 5-star
        });

        it("should not use 50/50 logic for Standard banner", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.STANDARD),
                    itemId: "10000003",
                    itemName: "Jean",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.STANDARD),
                    itemId: "10000003",
                    itemName: "Jean",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, String(GENSHIN_BANNERS.STANDARD));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(0);
        });

        it("should handle weapon banner guarantee (75/25)", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.WEAPON),
                    itemId: "11502", // Skyward Harp (Standard Weapon)
                    itemName: "Skyward Harp",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.WEAPON),
                    itemId: "11501", // Amos' Bow (Featured)
                    itemName: "Amos' Bow",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, String(GENSHIN_BANNERS.WEAPON));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(1);
        });

        it("should reset pity correctly between multiple 5-stars", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "1",
                    itemName: "Cool Steel",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "10000022",
                    itemName: "Venti",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "10000022",
                    itemName: "Venti",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 3000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, "limited_character");

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[2].pityAtPull).toBe(1);
        });

        it("should fallback gracefully when no banner phase is active", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "1",
                    itemName: "Cool Steel",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(0), // Way before any banner
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHARACTER),
                    itemId: "10000022",
                    itemName: "Venti",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(0 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, "limited_character");

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[1].bannerId).toBe(String(GENSHIN_BANNERS.CHARACTER)); // Should use bannerType as fallback
        });

        it("should not use 50/50 logic for Chronicled Wish (500)", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHRONICLED),
                    itemId: "10000003",
                    itemName: "Jean",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(GENSHIN_BANNERS.CHRONICLED),
                    itemId: "10000003",
                    itemName: "Jean",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1601287200000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = genshinAdapter.computePity(pulls, String(GENSHIN_BANNERS.CHRONICLED));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(0);
        });
    });
});
