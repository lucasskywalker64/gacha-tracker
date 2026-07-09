import { unzipSync } from "fflate";
import { uigfDict } from "@gacha-tracker/shared";
import type { ImportParser, ParsedImportResult, ParsedPull, ParseContext } from "./types";

/** paimon.moe sheet name → Genshin banner type integer */
const SHEET_BANNER_TYPES: Record<string, string> = {
    "Character Event": "301",
    "Weapon Event": "302",
    Standard: "200",
    "Beginners' Wish": "100",
    "Chronicled Wish": "500",
};

export class PaimonMoeParser implements ImportParser {
    formatId = "paimon-moe";
    displayName = "Paimon.moe Wish Export";
    acceptedExtensions = ".xlsx";

    // Safety limits for ZIP/XLSX decompression, exposed for configuration and testing
    maxEntryUncompressedSize = 10 * 1024 * 1024; // 10MB
    maxCompressionRatio = 100; // 100:1 ratio limit
    minSizeForRatioCheck = 100 * 1024; // 100KB minimum size for ratio checking

    async parse(buffer: Buffer, context?: ParseContext): Promise<ParsedImportResult> {
        const gameUid = context?.gameUid?.trim();
        if (!gameUid) {
            throw new Error(
                "A Genshin UID is required to import from paimon.moe. Please provide your UID."
            );
        }

        // ---------------------------------------------------------------------------
        // 1. Unzip the XLSX (OOXML = ZIP of XML files)
        // ---------------------------------------------------------------------------
        const maxEntryUncompressed = this.maxEntryUncompressedSize;
        const maxRatio = this.maxCompressionRatio;
        const minSizeForRatio = this.minSizeForRatioCheck;

        let files: ReturnType<typeof unzipSync>;
        try {
            files = unzipSync(new Uint8Array(buffer), {
                filter(file) {
                    // 0. Ensure size metadata is present to prevent size checks bypass
                    if (file.originalSize === undefined || typeof file.originalSize !== "number") {
                        throw new Error(
                            `XLSX entry "${file.name}" is missing size metadata and is treated as unsafe`
                        );
                    }

                    // 1. Enforce max uncompressed size per file
                    if (file.originalSize > maxEntryUncompressed) {
                        throw new Error(
                            `XLSX entry "${file.name}" exceeds safety limits (${file.originalSize} bytes)`
                        );
                    }

                    // 2. Enforce compression ratio limits to detect zip bombs (only for files > min size)
                    const ratio = file.originalSize / (file.size || 1);
                    if (file.originalSize > minSizeForRatio && ratio > maxRatio) {
                        throw new Error(
                            `XLSX entry "${file.name}" has suspicious compression ratio (${ratio.toFixed(0)}:1)`
                        );
                    }

                    // 3. Selective decompression: only inflate what we need
                    return (
                        file.name === "xl/workbook.xml" ||
                        file.name === "xl/_rels/workbook.xml.rels" ||
                        file.name === "xl/sharedStrings.xml" ||
                        file.name.startsWith("xl/worksheets/")
                    );
                },
            });
        } catch (e) {
            // Propagate safety validation errors directly so clients receive specific feedback
            if (
                e instanceof Error &&
                (e.message.includes("exceeds safety limits") ||
                    e.message.includes("suspicious compression ratio") ||
                    e.message.includes("missing size metadata"))
            ) {
                throw e;
            }
            throw new Error("Failed to unzip the uploaded file. Is it a valid .xlsx file?", {
                cause: e,
            });
        }

        const getText = (path: string): string | null => {
            const bytes = files[path];
            return bytes ? new TextDecoder().decode(bytes) : null;
        };

        // ---------------------------------------------------------------------------
        // 2. Parse workbook.xml to get sheet name → file path
        // ---------------------------------------------------------------------------
        const workbookXml = getText("xl/workbook.xml");
        if (!workbookXml) throw new Error("Invalid .xlsx file: missing xl/workbook.xml");

        const relsXml = getText("xl/_rels/workbook.xml.rels");
        if (!relsXml) throw new Error("Invalid .xlsx file: missing xl/_rels/workbook.xml.rels");

        // Map rId → relative target path (e.g. "rId4" → "worksheets/sheet1.xml")
        // Use an attribute-order independent regex parsing of <Relationship> tags
        const rIdToPath = new Map<string, string>();
        for (const relMatch of relsXml.matchAll(/<Relationship\s([^>]*)\/?>/g)) {
            const attrs = relMatch[1];
            const idMatch = attrs.match(/\bId="([^"]+)"/);
            const targetMatch = attrs.match(/\bTarget="([^"]+)"/);
            if (idMatch && targetMatch) {
                rIdToPath.set(idMatch[1], targetMatch[1]);
            }
        }

        // Map sheet name → "xl/worksheets/sheetN.xml"
        // Use an attribute-order independent regex parsing of <sheet> tags
        const sheetNameToPath = new Map<string, string>();
        for (const sheetMatch of workbookXml.matchAll(/<sheet\s([^>]*)\/?>/g)) {
            const attrs = sheetMatch[1];
            const nameMatch = attrs.match(/\bname="([^"]+)"/);
            const rIdMatch = attrs.match(/\br:id="([^"]+)"/);
            if (nameMatch && rIdMatch) {
                const sheetName = decodeXmlEntities(nameMatch[1]);
                const relPath = rIdToPath.get(rIdMatch[1]);
                if (relPath) {
                    sheetNameToPath.set(sheetName, `xl/${relPath}`);
                }
            }
        }

        // ---------------------------------------------------------------------------
        // 3. Parse xl/sharedStrings.xml into a flat string array
        // ---------------------------------------------------------------------------
        const sharedStringsXml = getText("xl/sharedStrings.xml");
        const sharedStrings: string[] = [];

        if (sharedStringsXml) {
            // Each <si> may contain <t> (simple) or <r><t> (rich text) nodes
            for (const siMatch of sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
                let combined = "";
                for (const tMatch of siMatch[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) {
                    combined += tMatch[1];
                }
                sharedStrings.push(decodeXmlEntities(combined));
            }
        }

        const resolveCell = (type: string | undefined, value: string): string =>
            type === "s" ? (sharedStrings[parseInt(value, 10)] ?? "") : value;

        // ---------------------------------------------------------------------------
        // 4. Parse each wish sheet
        // ---------------------------------------------------------------------------
        const allPulls: ParsedPull[] = [];
        const seenPullIds = new Set<string>();

        // Warn about any unrecognized sheets in the workbook (ignoring known non-wish sheets)
        const IGNORED_SHEETS = new Set(["banner list", "information"]);
        for (const sheetName of sheetNameToPath.keys()) {
            const cleanSheetName = sheetName.trim().toLowerCase();
            if (IGNORED_SHEETS.has(cleanSheetName)) {
                continue;
            }
            const isRecognized = Object.keys(SHEET_BANNER_TYPES).some(
                (k) => k.toLowerCase() === cleanSheetName
            );
            if (!isRecognized) {
                console.warn(
                    `[PaimonMoeParser] Sheet "${sheetName}" is unrecognized and will be skipped.`
                );
            }
        }

        for (const [sheetName, bannerType] of Object.entries(SHEET_BANNER_TYPES)) {
            // Find sheet name case-insensitively and with trimmed whitespace
            const matchingKey = Array.from(sheetNameToPath.keys()).find(
                (k) => k.trim().toLowerCase() === sheetName.toLowerCase()
            );
            if (!matchingKey) continue; // Sheet absent in this export

            const sheetPath = sheetNameToPath.get(matchingKey);
            if (!sheetPath) continue;

            const sheetXml = getText(sheetPath);
            if (!sheetXml) continue;

            const sheetPulls = parseWishSheet(
                sheetXml,
                resolveCell,
                matchingKey,
                bannerType,
                gameUid,
                seenPullIds
            );
            allPulls.push(...sheetPulls);
        }

        // Sort oldest-first across all sheets
        allPulls.sort((a, b) => {
            const diff = a.pulledAt.getTime() - b.pulledAt.getTime();
            return diff !== 0 ? diff : a.pullId.localeCompare(b.pullId);
        });

        return {
            games: [{ gameId: "genshin", gameUid, pulls: allPulls }],
        };
    }
}

// ---------------------------------------------------------------------------
// Sheet parsing
// ---------------------------------------------------------------------------

export function parseWishSheet(
    sheetXml: string,
    resolveCell: (type: string | undefined, value: string) => string,
    sheetName: string,
    bannerType: string,
    gameUid: string,
    seenPullIds: Set<string>
): ParsedPull[] {
    const pulls: ParsedPull[] = [];
    // Track how many pulls share the same second to assign a stable sequence index
    const secondCounter = new Map<string, number>();

    for (const rowMatch of sheetXml.matchAll(/<row\s[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const rowNum = parseInt(rowMatch[1], 10);
        if (rowNum === 1) continue; // Skip header row

        const cells = extractRowCells(rowMatch[2]);

        const typeVal = resolveCell(cells.A?.type, cells.A?.value ?? "");
        const nameVal = resolveCell(cells.B?.type, cells.B?.value ?? "");
        const timeVal = resolveCell(cells.C?.type, cells.C?.value ?? "");
        // Column D: rarity — always a plain numeric cell (no shared string)
        const rarityRaw = cells.D?.value ?? "";

        if (!typeVal || !nameVal || !timeVal) continue; // Empty or footer row

        const rarity = parseInt(rarityRaw, 10);
        if (isNaN(rarity) || rarity < 1 || rarity > 5) {
            throw new Error(
                `Invalid rarity value at row ${rowNum} of sheet "${sheetName}": "${rarityRaw}"`
            );
        }

        // "2022-02-19 16:22:15" — paimon.moe uses Asia/Shanghai (UTC+8)
        const pulledAt = parsePaimonTimestamp(timeVal);
        if (!pulledAt) {
            throw new Error(
                `Invalid timestamp at row ${rowNum} of sheet "${sheetName}": "${timeVal}"`
            );
        }

        // Deterministic pullId: gameUid_bannerType_YYYY-MM-DD-HH-mm-ss_seqWithinSecond
        const cleanTime = timeVal.replace(/[:\s]/g, "-");
        const secondKey = `${bannerType}_${cleanTime}`;
        const seq = secondCounter.get(secondKey) ?? 0;
        secondCounter.set(secondKey, seq + 1);

        const pullId = `${gameUid}_${bannerType}_${cleanTime}_${seq}`;

        if (seenPullIds.has(pullId)) {
            throw new Error(`Duplicate pullId detected: ${pullId}`);
        }
        seenPullIds.add(pullId);

        // Resolve itemId via UIGF dict (keyed by lowercase name)
        const dictEntry = uigfDict[nameVal.toLowerCase()];
        const itemId = dictEntry?.id ?? `name_${nameVal}`;
        const itemType = dictEntry?.type ?? typeVal;

        pulls.push({ pullId, bannerType, itemId, itemName: nameVal, itemType, rarity, pulledAt });
    }

    return pulls;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

interface CellData {
    value: string;
    type?: string;
}

/** Extract cells from a <row> XML fragment into a map of column letter → { value, type }. */
function extractRowCells(rowXml: string): Partial<Record<string, CellData>> {
    const cells: Partial<Record<string, CellData>> = {};
    for (const m of rowXml.matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
        const rAttr = m[1].match(/\br="([A-Z]+)\d+"/);
        if (!rAttr) continue;
        const col = rAttr[1];
        const tAttr = m[1].match(/\bt="([^"]+)"/);
        const vMatch = m[2].match(/<v>([^<]*)<\/v>/);
        cells[col] = { value: vMatch?.[1] ?? "", type: tAttr?.[1] };
    }
    return cells;
}

/**
 * Parse paimon.moe timestamp "YYYY-MM-DD HH:mm:ss" as UTC+8.
 */
function parsePaimonTimestamp(str: string): Date | null {
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
    return isNaN(d.getTime()) ? null : d;
}

/** Decode common XML character entities. */
function decodeXmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
