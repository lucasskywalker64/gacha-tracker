import { describe, it, expect } from "bun:test";
import { StarRailStationParser } from "./starrail-station";
import LZString from "lz-string";

describe("StarRailStationParser", () => {
    const parser = new StarRailStationParser();

    describe("CSV Import Mode", () => {
        it("should parse and map a valid Star Rail Station CSV export", async () => {
            const csvContent = [
                "uid,id,rarity,time,banner,type,manual",
                "1682532600000704444,1009,4,2023-04-26T18:14:12.000Z,1001,1,false",
                "1682698200001377844,20003,3,2023-04-28T16:48:36.000Z,1001,1,false",
                "1682716200001341844,23002,5,2023-04-28T21:53:11.000Z,1001,11,false",
            ].join("\n");

            const buffer = Buffer.from(csvContent, "utf-8");
            const result = await parser.parse(buffer);

            expect(result.games).toHaveLength(1);
            const game = result.games[0];
            expect(game.gameId).toBe("starrail");
            expect(game.gameUid).toBe("StarRailStation");
            expect(game.pulls).toHaveLength(3);

            // Asta (1009) -> 4-star character
            const pull1 = game.pulls[0];
            expect(pull1.itemId).toBe("1009");
            expect(pull1.itemName).toBe("Asta");
            expect(pull1.itemType).toBe("Character");
            expect(pull1.rarity).toBe(4);
            expect(pull1.bannerType).toBe("1");
            expect(pull1.pullId).toBe("1682532600000704444");

            // 23002 -> Something Irreplaceable (Light Cone)
            const pull3 = game.pulls[2];
            expect(pull3.itemId).toBe("23002");
            expect(pull3.itemName).toBe("Something Irreplaceable");
            expect(pull3.itemType).toBe("Light Cone");
            expect(pull3.rarity).toBe(5);
            expect(pull3.bannerType).toBe("11");
            expect(pull3.pullId).toBe("1682716200001341844");
        });

        it("should handle unknown/new items gracefully using heuristics", async () => {
            const csvContent = [
                "uid,id,rarity,time,banner,type,manual",
                "1682532600000704444,9999,4,2023-04-26T18:14:12.000Z,1001,1,false",
                "1682698200001377844,99999,3,2023-04-28T16:48:36.000Z,1001,1,false",
            ].join("\n");

            const buffer = Buffer.from(csvContent, "utf-8");
            const result = await parser.parse(buffer);

            const pulls = result.games[0].pulls;
            expect(pulls).toHaveLength(2);

            // 9999 (4 digits) -> Character
            expect(pulls[0].itemName).toBe("Unknown Item (9999)");
            expect(pulls[0].itemType).toBe("Character");

            // 99999 (5 digits) -> Light Cone
            expect(pulls[1].itemName).toBe("Unknown Item (99999)");
            expect(pulls[1].itemType).toBe("Light Cone");
        });

        it("should throw an error for missing required columns", async () => {
            const csvContent = [
                "id,rarity,time,banner,type,manual", // Missing uid
                "1009,4,2023-04-26T18:14:12.000Z,1001,1,false",
            ].join("\n");

            const buffer = Buffer.from(csvContent, "utf-8");
            expect(parser.parse(buffer)).rejects.toThrow();
        });
    });

    describe("DAT Import Mode", () => {
        it("should decompress, parse, and map a valid Star Rail Station DAT backup file", async () => {
            const mockBackup = {
                data: {
                    stores: {
                        "1_warp-v2": {
                            items_1: [
                                {
                                    uid: "1682698200001377844",
                                    itemId: 20003, // Amber (Light Cone)
                                    rarity: 3,
                                    timestamp: 1682698116000,
                                    gachaType: 1,
                                },
                            ],
                            items_21: [
                                {
                                    uid: "1682532600000704444",
                                    itemId: 1009, // Arlan (Character)
                                    rarity: 4,
                                    timestamp: 1682532852000,
                                    gachaType: 21, // Character Event Rerun
                                },
                            ],
                        },
                    },
                },
            };

            const compressed = LZString.compressToUTF16(JSON.stringify(mockBackup));
            const datBuffer = Buffer.concat([
                Buffer.from("srs", "utf-8"),
                Buffer.from(compressed, "utf-8"),
            ]);

            const result = await parser.parse(datBuffer);

            expect(result.games).toHaveLength(1);
            const game = result.games[0];
            expect(game.gameId).toBe("starrail");
            expect(game.gameUid).toBe("StarRailStation");
            expect(game.pulls).toHaveLength(2);

            // Verify chronological sorting (oldest first: timestamp 1682532852000 vs 1682698116000? Wait, 1682532852000 is 2023-04-26, which is older than 2023-04-28.
            // So Arlan comes first!)
            const pull1 = game.pulls[0];
            expect(pull1.itemId).toBe("1009");
            expect(pull1.itemName).toBe("Asta");
            expect(pull1.itemType).toBe("Character");
            expect(pull1.rarity).toBe(4);
            expect(pull1.bannerType).toBe("11"); // Mapped from 21 -> 11

            const pull2 = game.pulls[1];
            expect(pull2.itemId).toBe("20003");
            expect(pull2.itemName).toBe("Amber");
            expect(pull2.itemType).toBe("Light Cone");
            expect(pull2.rarity).toBe(3);
            expect(pull2.bannerType).toBe("1"); // Standard
        });

        it("should throw an error for invalid magic header", async () => {
            const rawContent = Buffer.from("bad_header_payload", "utf-8");
            // Not starting with 'srs' and not a valid CSV header list
            expect(parser.parse(rawContent)).rejects.toThrow();
        });

        it("should throw an error for corrupt LZString payload", async () => {
            const datBuffer = Buffer.concat([
                Buffer.from("srs", "utf-8"),
                Buffer.from("not_a_valid_lzstring_payload", "utf-8"),
            ]);
            expect(parser.parse(datBuffer)).rejects.toThrow();
        });

        it("should abort early and throw when decompressed payload size exceeds the limit", async () => {
            const mockBackup = {
                data: {
                    stores: {
                        "1_warp-v2": {
                            items_1: [
                                {
                                    uid: "1682698200001377844",
                                    itemId: 20003,
                                    rarity: 3,
                                    timestamp: 1682698116000,
                                    gachaType: 1,
                                },
                            ],
                        },
                    },
                },
            };

            const compressed = LZString.compressToUTF16(JSON.stringify(mockBackup));
            const datBuffer = Buffer.concat([
                Buffer.from("srs", "utf-8"),
                Buffer.from(compressed, "utf-8"),
            ]);

            const customParser = new StarRailStationParser();
            customParser.maxDecompressedLength = 50;

            await expect(customParser.parse(datBuffer)).rejects.toThrow(
                "Decompressed size validation failed"
            );
        });
    });
});
