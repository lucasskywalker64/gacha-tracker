import { describe, expect, it, beforeEach } from "bun:test";
import { zzzAdapter } from "./index";
import { banners, ZZZ_BANNERS } from "@gacha-tracker/shared";

describe("zzzAdapter", () => {
    beforeEach(() => {
        banners.games.zzz = [
            {
                phase: "1.0.1",
                name: "Ellen",
                featuredCharacters: ["1011"], // Ellen
                mainCharacterId: "1011",
                featuredWeapons: ["1111"], // Deep Sea Visitor
                mainWeaponId: "1111",
                startTime: 1720000000000,
                endTime: 1722000000000,
            },
        ];
    });

    describe("computePity", () => {
        it("should correctly compute pity for character banner", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1",
                    itemName: "W-Engine",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1011",
                    itemName: "Ellen",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.CHARACTER));

            expect(processed[0].pityAtPull).toBe(1);
            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[1].bannerId).toBe("1011");
        });

        it("should handle 50/50 loss and guarantee for character banner", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1001", // Standard character
                    itemName: "Nekomata",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1011", // Ellen
                    itemName: "Ellen",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.CHARACTER));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(1);
        });

        it("should handle 75/25 for weapon banner", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.WEAPON),
                    itemId: "1101", // Standard weapon
                    itemName: "Steel Cushion",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.WEAPON),
                    itemId: "1111", // Deep Sea Visitor
                    itemName: "Deep Sea Visitor",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.WEAPON));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(1);
        });

        it("should NOT have 50/50 for Bangboo banner", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.BANGBOO),
                    itemId: "2001", // Random Bangboo
                    itemName: "Sharkboo",
                    itemType: "Bangboo",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.BANGBOO),
                    itemId: "2001",
                    itemName: "Sharkboo",
                    itemType: "Bangboo",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.BANGBOO));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(0);
        });

        it("should handle standard banner without guarantee", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.STANDARD),
                    itemId: "1001",
                    itemName: "Nekomata",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.STANDARD),
                    itemId: "1101",
                    itemName: "Steel Cushion",
                    itemType: "Weapon",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.STANDARD));

            expect(processed[0].wasGuaranteed).toBe(0);
            expect(processed[1].wasGuaranteed).toBe(0);
        });

        it("should reset pity correctly between multiple S-ranks", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1",
                    itemName: "W-Engine",
                    itemType: "Weapon",
                    rarity: 3,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1011",
                    itemName: "Ellen",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1011",
                    itemName: "Ellen",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 3000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.CHARACTER));

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[2].pityAtPull).toBe(1);
        });

        it("should reset pity on Bangboo banner after pulling S-rank", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.BANGBOO),
                    itemId: "1",
                    itemName: "A-Rank Bangboo",
                    itemType: "Bangboo",
                    rarity: 4,
                    pulledAt: new Date(1720000000000 + 1000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "2",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.BANGBOO),
                    itemId: "2001",
                    itemName: "Sharkboo",
                    itemType: "Bangboo",
                    rarity: 5,
                    pulledAt: new Date(1720000000000 + 2000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
                {
                    pullId: "3",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.BANGBOO),
                    itemId: "1",
                    itemName: "A-Rank Bangboo",
                    itemType: "Bangboo",
                    rarity: 4,
                    pulledAt: new Date(1720000000000 + 3000),
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.BANGBOO));

            expect(processed[1].pityAtPull).toBe(2);
            expect(processed[2].pityAtPull).toBe(1);
        });

        it("should fallback to bannerType for attribution when no phase is active", () => {
            const pulls = [
                {
                    pullId: "1",
                    gameUid: "123",
                    bannerType: String(ZZZ_BANNERS.CHARACTER),
                    itemId: "1011",
                    itemName: "Ellen",
                    itemType: "Character",
                    rarity: 5,
                    pulledAt: new Date(0), // No banner active
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                },
            ];

            const processed = zzzAdapter.computePity(pulls, String(ZZZ_BANNERS.CHARACTER));

            expect(processed[0].bannerId).toBe(String(ZZZ_BANNERS.CHARACTER));
        });
    });
});
