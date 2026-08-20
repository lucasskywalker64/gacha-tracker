import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { uigfDict } from "@gacha-tracker/shared";
import type { ImportParser, ParsedImportResult, ParsedPull, ParseContext } from "../types";

/** paimon.moe sheet name → Genshin banner type integer */
const SHEET_BANNER_TYPES: Record<string, string> = {
    "Character Event": "301",
    "Weapon Event": "302",
    Standard: "200",
    "Beginners' Wish": "100",
    "Chronicled Wish": "500",
};

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    trimValues: true,
});

function toArray<T>(node: T | T[] | undefined | null): T[] {
    if (Array.isArray(node)) return node;
    return node ? [node] : [];
}

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
                    if (file.originalSize === undefined || typeof file.originalSize !== "number") {
                        throw new Error(
                            `XLSX entry "${file.name}" is missing size metadata and is treated as unsafe`
                        );
                    }

                    if (file.originalSize > maxEntryUncompressed) {
                        throw new Error(
                            `XLSX entry "${file.name}" exceeds safety limits (${file.originalSize} bytes)`
                        );
                    }

                    const ratio = file.originalSize / (file.size || 1);
                    if (file.originalSize > minSizeForRatio && ratio > maxRatio) {
                        throw new Error(
                            `XLSX entry "${file.name}" has suspicious compression ratio (${ratio.toFixed(0)}:1)`
                        );
                    }

                    return (
                        file.name === "xl/workbook.xml" ||
                        file.name === "xl/_rels/workbook.xml.rels" ||
                        file.name === "xl/sharedStrings.xml" ||
                        file.name.startsWith("xl/worksheets/")
                    );
                },
            });
        } catch (e) {
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
        const rIdToPath = new Map<string, string>();
        try {
            const parsedRels = xmlParser.parse(relsXml);
            const relList = toArray(parsedRels?.Relationships?.Relationship);

            for (const rel of relList) {
                const id = rel?.["@_Id"];
                const target = rel?.["@_Target"];
                if (id && target) {
                    rIdToPath.set(String(id), String(target));
                }
            }
        } catch {
            throw new Error("Invalid .xlsx file: corrupt xl/_rels/workbook.xml.rels");
        }

        // Map sheet name → "xl/worksheets/sheetN.xml"
        const sheetNameToPath = new Map<string, string>();
        try {
            const parsedWorkbook = xmlParser.parse(workbookXml);
            const sheetList = toArray(parsedWorkbook?.workbook?.sheets?.sheet);

            for (const sheet of sheetList) {
                const name = sheet?.["@_name"];
                let rId = sheet?.["@_r:id"] ?? sheet?.["@_rId"] ?? sheet?.["@_id"];
                if (!rId) {
                    for (const k of Object.keys(sheet || {})) {
                        if (k.toLowerCase().endsWith(":id") || k.toLowerCase() === "@_id") {
                            rId = sheet[k];
                            break;
                        }
                    }
                }
                if (name && rId) {
                    const sheetName = decodeXmlEntities(String(name));
                    const relPath = rIdToPath.get(String(rId));
                    if (relPath) {
                        sheetNameToPath.set(sheetName, `xl/${relPath}`);
                    }
                }
            }
        } catch {
            throw new Error("Invalid .xlsx file: corrupt xl/workbook.xml");
        }

        // ---------------------------------------------------------------------------
        // 3. Parse xl/sharedStrings.xml into a flat string array
        // ---------------------------------------------------------------------------
        const sharedStringsXml = getText("xl/sharedStrings.xml");
        const sharedStrings: string[] = [];

        if (sharedStringsXml) {
            try {
                const parsedStrings = xmlParser.parse(sharedStringsXml);
                const siList = toArray(parsedStrings?.sst?.si);

                for (const si of siList) {
                    let combined = "";
                    if (typeof si === "string" || typeof si === "number") {
                        combined = String(si);
                    } else if (si && typeof si === "object") {
                        if (si.t !== undefined) {
                            combined += extractTextContent(si.t);
                        }
                        if (si.r) {
                            const runs = toArray(si.r);
                            for (const r of runs) {
                                if (r?.t !== undefined) {
                                    combined += extractTextContent(r.t);
                                }
                            }
                        }
                    }
                    sharedStrings.push(decodeXmlEntities(combined));
                }
            } catch (e) {
                console.warn(
                    "[PaimonMoeParser] Failed to parse xl/sharedStrings.xml; shared strings will be empty.",
                    e
                );
            }
        }

        const resolveCell = (type: string | undefined, value: string): string =>
            type === "s" ? (sharedStrings[parseInt(value, 10)] ?? "") : value;

        // ---------------------------------------------------------------------------
        // 4. Parse each wish sheet
        // ---------------------------------------------------------------------------
        const allPulls: ParsedPull[] = [];
        const seenPullIds = new Set<string>();

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
            const matchingKey = Array.from(sheetNameToPath.keys()).find(
                (k) => k.trim().toLowerCase() === sheetName.toLowerCase()
            );
            if (!matchingKey) continue;

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

        allPulls.sort((a, b) => {
            const diff = a.pulledAt.getTime() - b.pulledAt.getTime();
            return diff !== 0 ? diff : a.pullId.localeCompare(b.pullId);
        });

        let fileVersion: string | undefined;
        const infoSheetKey = Array.from(sheetNameToPath.keys()).find(
            (k) => k.trim().toLowerCase() === "information"
        );
        if (infoSheetKey) {
            const infoPath = sheetNameToPath.get(infoSheetKey);
            if (infoPath) {
                const infoXml = getText(infoPath);
                if (infoXml) {
                    fileVersion = parseInformationSheet(infoXml, resolveCell);
                }
            }
        }

        return {
            ...(fileVersion ? { fileVersion } : {}),
            games: [{ gameId: "genshin", gameUid, pulls: allPulls }],
        };
    }
}

// ---------------------------------------------------------------------------
// Information Sheet parsing
// ---------------------------------------------------------------------------

export function parseInformationSheet(
    sheetXml: string,
    resolveCell: (type: string | undefined, value: string) => string
): string | undefined {
    try {
        const parsedSheet = xmlParser.parse(sheetXml);
        const rowList = toArray(parsedSheet?.worksheet?.sheetData?.row);

        for (const row of rowList) {
            const cells = extractRowCellsFromObj(row?.c);
            const colA = resolveCell(cells.A?.type, cells.A?.value ?? "")
                .trim()
                .toLowerCase();
            const colB = resolveCell(cells.B?.type, cells.B?.value ?? "").trim();

            if (!colA || !colB) continue;

            if (colA.includes("version")) {
                return colB;
            }
        }
    } catch {
        // Fallback silently if Information sheet parsing fails
    }
    return undefined;
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
    const secondCounter = new Map<string, number>();

    const parsedSheet = xmlParser.parse(sheetXml);
    const rowList = toArray(parsedSheet?.worksheet?.sheetData?.row);

    for (const row of rowList) {
        const rowNumStr = row?.["@_r"];
        const rowNum = rowNumStr ? parseInt(String(rowNumStr), 10) : 0;
        if (rowNum === 1) continue; // Skip header row

        const cells = extractRowCellsFromObj(row?.c);

        const typeVal = resolveCell(cells.A?.type, cells.A?.value ?? "");
        const nameVal = resolveCell(cells.B?.type, cells.B?.value ?? "");
        const timeVal = resolveCell(cells.C?.type, cells.C?.value ?? "");
        const rarityRaw = cells.D?.value ?? "";

        if (!typeVal || !nameVal || !timeVal) continue;

        const rarity = parseInt(rarityRaw, 10);
        if (isNaN(rarity) || rarity < 1 || rarity > 5) {
            throw new Error(
                `Invalid rarity value at row ${rowNum} of sheet "${sheetName}": "${rarityRaw}"`
            );
        }

        const pulledAt = parsePaimonTimestamp(timeVal);
        if (!pulledAt) {
            throw new Error(
                `Invalid timestamp at row ${rowNum} of sheet "${sheetName}": "${timeVal}"`
            );
        }

        const cleanTime = timeVal.replace(/[:\s]/g, "-");
        const secondKey = `${bannerType}_${cleanTime}`;
        const seq = secondCounter.get(secondKey) ?? 0;
        secondCounter.set(secondKey, seq + 1);

        const pullId = `${gameUid}_${bannerType}_${cleanTime}_${seq}`;

        if (seenPullIds.has(pullId)) {
            throw new Error(`Duplicate pullId detected: ${pullId}`);
        }
        seenPullIds.add(pullId);

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

function extractRowCellsFromObj(cNode: unknown): Partial<Record<string, CellData>> {
    const cells: Partial<Record<string, CellData>> = {};
    const cellList = Array.isArray(cNode) ? cNode : cNode ? [cNode] : [];

    for (const c of cellList) {
        const rAttr = c?.["@_r"];
        if (!rAttr) continue;
        const colMatch = String(rAttr).match(/^([A-Z]+)\d+$/);
        if (!colMatch) continue;
        const col = colMatch[1];
        const type = c?.["@_t"];
        let val = "";
        if (c?.v !== undefined && c?.v !== null) {
            if (typeof c.v === "object" && "#text" in c.v) {
                val = String(c.v["#text"] ?? "");
            } else {
                val = String(c.v);
            }
        }
        cells[col] = { value: val, type: type ? String(type) : undefined };
    }

    return cells;
}

function extractTextContent(tNode: unknown): string {
    if (typeof tNode === "string" || typeof tNode === "number") {
        return String(tNode);
    }
    if (typeof tNode === "object" && tNode !== null) {
        if ("#text" in tNode) return String((tNode as { "#text": unknown })["#text"]);
    }
    return "";
}

function parsePaimonTimestamp(str: string): Date | null {
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
    return isNaN(d.getTime()) ? null : d;
}

function decodeXmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
