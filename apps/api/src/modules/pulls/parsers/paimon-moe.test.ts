import { describe, it, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { PaimonMoeParser, parseWishSheet } from "./paimon-moe";
import { createMockPaimonXlsx } from "./paimon-moe-mock";

const MOCK_WISH_DATA = {
    "Character Event": [
        ["Character", "Diona", "2022-02-19 16:22:15", 4],
        ["Character", "Sangonomiya Kokomi", "2022-02-19 16:22:20", 5],
    ],
    "Weapon Event": [["Weapon", "Dull Blade", "2022-02-19 16:22:25", 3]],
    Standard: [["Character", "Diluc", "2022-02-19 16:22:30", 5]],
    "Beginners' Wish": [["Character", "Noelle", "2022-02-19 16:22:35", 4]],
    "Chronicled Wish": [["Character", "Mona", "2024-03-15 12:00:00", 5]],
    "Some Unrecognized Sheet": [["Character", "Amber", "2024-03-15 13:00:00", 4]],
    "Banner List": [],
    Information: [],
};

const MOCK_XLSX_BUFFER = createMockPaimonXlsx(MOCK_WISH_DATA);

describe("PaimonMoeParser", () => {
    const parser = new PaimonMoeParser();
    const TEST_UID = "700000001";

    it("has correct metadata", () => {
        expect(parser.formatId).toBe("paimon-moe");
        expect(parser.displayName).toBe("Paimon.moe Wish Export");
        expect(parser.acceptedExtensions).toBe(".xlsx");
    });

    it("throws if no gameUid is provided", async () => {
        const buf = MOCK_XLSX_BUFFER;
        await expect(parser.parse(buf)).rejects.toThrow("Genshin UID is required");
        await expect(parser.parse(buf, {})).rejects.toThrow("Genshin UID is required");
        await expect(parser.parse(buf, { gameUid: "" })).rejects.toThrow("Genshin UID is required");
    });

    it("throws on a non-xlsx buffer", async () => {
        const garbage = Buffer.from("this is not an xlsx file");
        await expect(parser.parse(garbage, { gameUid: TEST_UID })).rejects.toThrow();
    });

    describe("with fixture file", () => {
        let result: Awaited<ReturnType<typeof parser.parse>>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let warnSpy: any;

        beforeAll(async () => {
            warnSpy = spyOn(console, "warn").mockImplementation(() => {});
            result = await parser.parse(MOCK_XLSX_BUFFER, { gameUid: TEST_UID });
        });

        afterAll(() => {
            warnSpy.mockRestore();
        });

        it("returns exactly one game entry for genshin", () => {
            expect(result.games).toHaveLength(1);
            expect(result.games[0].gameId).toBe("genshin");
            expect(result.games[0].gameUid).toBe(TEST_UID);
        });

        it("parses pulls from all five wish sheets", () => {
            const pulls = result.games[0].pulls;
            expect(pulls.length).toBeGreaterThan(0);

            // All five banner types should be present
            const bannerTypes = new Set(pulls.map((p) => p.bannerType));
            expect(bannerTypes.has("301")).toBe(true); // Character Event
            expect(bannerTypes.has("302")).toBe(true); // Weapon Event
            expect(bannerTypes.has("200")).toBe(true); // Standard
            expect(bannerTypes.has("100")).toBe(true); // Beginners
            expect(bannerTypes.has("500")).toBe(true); // Chronicled Wish
        });

        it("logs a warning for the unrecognized sheet", () => {
            expect(warnSpy).toHaveBeenCalled();
            const calledWith = warnSpy.mock.calls.some(
                (args: unknown[]) =>
                    typeof args[0] === "string" &&
                    args[0].includes('Sheet "Some Unrecognized Sheet" is unrecognized')
            );
            expect(calledWith).toBe(true);

            // Verify Banner List and Information sheets do not trigger warnings
            const ignoredCalled = warnSpy.mock.calls.some(
                (args: unknown[]) =>
                    typeof args[0] === "string" &&
                    (args[0].includes('Sheet "Banner List" is unrecognized') ||
                        args[0].includes('Sheet "Information" is unrecognized'))
            );
            expect(ignoredCalled).toBe(false);
        });

        it("all pulls are sorted oldest-first", () => {
            const pulls = result.games[0].pulls;
            for (let i = 1; i < pulls.length; i++) {
                expect(pulls[i].pulledAt.getTime()).toBeGreaterThanOrEqual(
                    pulls[i - 1].pulledAt.getTime()
                );
            }
        });

        it("all pullIds are unique", () => {
            const pulls = result.games[0].pulls;
            const ids = pulls.map((p) => p.pullId);
            const unique = new Set(ids);
            expect(unique.size).toBe(ids.length);
        });

        it("pullIds contain the gameUid and bannerType", () => {
            const pulls = result.games[0].pulls;
            for (const p of pulls) {
                expect(p.pullId).toStartWith(`${TEST_UID}_${p.bannerType}_`);
            }
        });

        it("all pulls have valid rarity (3, 4 or 5)", () => {
            const pulls = result.games[0].pulls;
            for (const p of pulls) {
                expect([3, 4, 5]).toContain(p.rarity);
            }
        });

        it("all pulls have valid pulledAt dates", () => {
            const pulls = result.games[0].pulls;
            for (const p of pulls) {
                expect(p.pulledAt).toBeInstanceOf(Date);
                expect(isNaN(p.pulledAt.getTime())).toBe(false);
            }
        });

        it("resolves itemId from uigfDict for known items (e.g. Diona)", () => {
            const pulls = result.games[0].pulls;
            const dionaPull = pulls.find((p) => p.itemName === "Diona");
            // Diona's Genshin ID via UIGF is 10000039
            expect(dionaPull).toBeDefined();
            expect(dionaPull!.itemId).toBe("10000039");
            expect(dionaPull!.itemType).toBe("Character");
            expect(dionaPull!.rarity).toBe(4);
        });

        it("falls back gracefully for items not in uigfDict", () => {
            // All pulls should still have an itemId even for unknowns
            const pulls = result.games[0].pulls;
            for (const p of pulls) {
                expect(p.itemId).toBeTruthy();
                expect(p.itemName).toBeTruthy();
            }
        });
    });

    describe("safety limit checks", () => {
        it("throws if an entry uncompressed size exceeds maxEntryUncompressedSize", async () => {
            const strictParser = new PaimonMoeParser();
            strictParser.maxEntryUncompressedSize = 50; // 50 bytes (mock files will exceed this)

            await expect(
                strictParser.parse(MOCK_XLSX_BUFFER, { gameUid: TEST_UID })
            ).rejects.toThrow("exceeds safety limits");
        });

        it("throws if compression ratio exceeds limit for files above minimum size", async () => {
            const strictParser = new PaimonMoeParser();
            strictParser.maxCompressionRatio = 0.01;
            strictParser.minSizeForRatioCheck = 10;

            await expect(
                strictParser.parse(MOCK_XLSX_BUFFER, { gameUid: TEST_UID })
            ).rejects.toThrow("suspicious compression ratio");
        });

        it("does not throw if compression ratio is high but file size is below minSizeForRatioCheck", async () => {
            const strictParser = new PaimonMoeParser();
            strictParser.maxCompressionRatio = 0.01;
            strictParser.minSizeForRatioCheck = 10 * 1024 * 1024; // 10MB

            // Should parse successfully because no entry is > 10MB
            const res = await strictParser.parse(MOCK_XLSX_BUFFER, { gameUid: TEST_UID });
            expect(res.games[0].pulls.length).toBeGreaterThan(0);
        });
    });

    describe("row-level validation error paths", () => {
        it("throws on invalid rarity value", async () => {
            const malformedData = {
                "Character Event": [
                    ["Character", "Diona", "2022-02-19 16:22:15", 6], // invalid rarity
                ],
            };
            const buffer = createMockPaimonXlsx(malformedData);
            await expect(parser.parse(buffer, { gameUid: TEST_UID })).rejects.toThrow(
                /Invalid rarity value at row 2 of sheet "Character Event"/
            );
        });

        it("throws on invalid timestamp format", async () => {
            const malformedData = {
                "Character Event": [["Character", "Diona", "invalid-timestamp-format", 4]],
            };
            const buffer = createMockPaimonXlsx(malformedData);
            await expect(parser.parse(buffer, { gameUid: TEST_UID })).rejects.toThrow(
                /Invalid timestamp at row 2 of sheet "Character Event"/
            );
        });

        it("throws on duplicate pullId", () => {
            const sheetXml = `
                <worksheet>
                    <sheetData>
                        <row r="2">
                            <c r="A2" t="s"><v>0</v></c>
                            <c r="B2" t="s"><v>1</v></c>
                            <c r="C2" t="s"><v>2</v></c>
                            <c r="D2"><v>4</v></c>
                        </row>
                    </sheetData>
                </worksheet>
            `;
            const resolveCellMock = (_t: string | undefined, v: string) => {
                if (v === "0") return "Character";
                if (v === "1") return "Diona";
                if (v === "2") return "2022-02-19 16:22:15";
                return v;
            };

            const seenPullIds = new Set<string>(["700000001_301_2022-02-19-16-22-15_0"]);

            expect(() =>
                parseWishSheet(
                    sheetXml,
                    resolveCellMock,
                    "Character Event",
                    "301",
                    TEST_UID,
                    seenPullIds
                )
            ).toThrow("Duplicate pullId detected: 700000001_301_2022-02-19-16-22-15_0");
        });
    });
});
