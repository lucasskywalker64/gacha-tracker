import { srgfDict } from "@gacha-tracker/shared";
import type { ImportParser, ParsedImportResult, ParsedPull } from "./types";
import LZString from "lz-string";

export class StarRailStationParser implements ImportParser {
    formatId = "starrail-station";
    displayName = "Star Rail Station Backup";
    acceptedExtensions = ".csv,.dat";

    async parse(buffer: Buffer): Promise<ParsedImportResult> {
        // Detect format: DAT files always start with 'srs'
        const isDat = buffer.subarray(0, 3).toString("utf-8") === "srs";

        if (isDat) {
            return this.parseDat(buffer);
        } else {
            return this.parseCsv(buffer);
        }
    }

    private parseDat(buffer: Buffer): ParsedImportResult {
        const payloadStr = buffer.subarray(3).toString("utf-8");
        const decompressed = LZString.decompressFromUTF16(payloadStr);
        if (!decompressed) {
            throw new Error("Failed to decompress Star Rail Station backup data");
        }

        let root: unknown;
        try {
            root = JSON.parse(decompressed);
        } catch (e) {
            throw new Error("Decompressed Star Rail Station backup data is not valid JSON", {
                cause: e,
            });
        }

        const typedRoot = root as {
            data?: {
                stores?: {
                    [key: string]:
                        | {
                              [key: string]:
                                  | Array<{
                                        uid?: string | number;
                                        itemId?: string | number;
                                        rarity?: number;
                                        timestamp?: number;
                                        gachaType?: number;
                                    }>
                                  | undefined;
                          }
                        | undefined;
                };
            };
        };

        const warpStore = typedRoot.data?.stores?.["1_warp-v2"];
        if (!warpStore) {
            throw new Error("Star Rail Station backup does not contain warp history data");
        }

        const pulls: ParsedPull[] = [];
        const seenPullIds = new Set<string>();
        const itemKeys = ["items_1", "items_2", "items_11", "items_12", "items_21", "items_22"];

        for (const key of itemKeys) {
            const items = warpStore[key];
            if (!Array.isArray(items)) continue;

            for (let idx = 0; idx < items.length; idx++) {
                const item = items[idx];
                const pullId = item.uid ? String(item.uid) : null;
                const itemId = item.itemId ? String(item.itemId) : null;
                const rarity = item.rarity !== undefined ? Number(item.rarity) : NaN;
                const timestamp = item.timestamp !== undefined ? Number(item.timestamp) : NaN;
                const rawGachaType = item.gachaType !== undefined ? Number(item.gachaType) : NaN;

                if (
                    !pullId ||
                    !itemId ||
                    isNaN(rarity) ||
                    isNaN(timestamp) ||
                    isNaN(rawGachaType)
                ) {
                    throw new Error(
                        `Invalid warp record detected in backup at ${key} index ${idx}`
                    );
                }

                // Map SRS internal rerun gacha types (21, 22) back to official Hoyoverse types (11, 12)
                let bannerType = String(rawGachaType);
                if (bannerType === "21") bannerType = "11";
                if (bannerType === "22") bannerType = "12";

                const pulledAt = new Date(timestamp);
                if (isNaN(pulledAt.getTime())) {
                    throw new Error(`Invalid timestamp detected in backup at ${key} index ${idx}`);
                }

                if (seenPullIds.has(pullId)) {
                    throw new Error(
                        `Duplicate pullId collision detected in backup file: ${pullId}`
                    );
                }
                seenPullIds.add(pullId);

                // Resolve item name and type using the dictionary
                const dictEntry = srgfDict[itemId];
                let itemName = `Unknown Item (${itemId})`;
                let itemType = itemId.length === 4 ? "Character" : "Light Cone";

                if (dictEntry) {
                    itemName = dictEntry.name;
                    itemType = dictEntry.type;
                }

                pulls.push({
                    pullId,
                    bannerType,
                    itemId,
                    itemName,
                    itemType,
                    rarity,
                    pulledAt,
                });
            }
        }

        // Sort pulls chronologically (oldest-first)
        pulls.sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());

        return {
            games: [
                {
                    gameId: "starrail",
                    gameUid: "StarRailStation",
                    pulls,
                },
            ],
        };
    }

    private parseCsv(buffer: Buffer): ParsedImportResult {
        const text = buffer.toString("utf-8");
        const lines = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (lines.length === 0) {
            throw new Error("Empty CSV file");
        }

        const headers = lines[0].split(",").map((h) =>
            h
                .trim()
                .toLowerCase()
                .replace(/^["']|["']$/g, "")
        );
        const uidIndex = headers.indexOf("uid");
        const idIndex = headers.indexOf("id");
        const rarityIndex = headers.indexOf("rarity");
        const timeIndex = headers.indexOf("time");
        const bannerIndex = headers.indexOf("banner");
        const typeIndex = headers.indexOf("type");

        if (
            uidIndex === -1 ||
            idIndex === -1 ||
            rarityIndex === -1 ||
            timeIndex === -1 ||
            typeIndex === -1
        ) {
            throw new Error(
                "Invalid CSV headers. Expected columns: uid, id, rarity, time, banner, type"
            );
        }

        const pulls: ParsedPull[] = [];
        const seenPullIds = new Set<string>();

        // Process data lines
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
            if (parts.length < headers.length) {
                // Skip malformed/incomplete lines silently or throw
                continue;
            }

            const pullId = parts[uidIndex];
            const itemId = parts[idIndex];
            const rarity = parseInt(parts[rarityIndex], 10);
            const timeStr = parts[timeIndex];
            const bannerType = parts[typeIndex];
            const bannerId = bannerIndex !== -1 ? parts[bannerIndex] : null;

            if (!pullId || !itemId || isNaN(rarity) || !timeStr || !bannerType) {
                throw new Error(`Invalid row data at line ${i + 1}: ${line}`);
            }

            const pulledAt = new Date(timeStr);
            if (isNaN(pulledAt.getTime())) {
                throw new Error(`Invalid date format at line ${i + 1}: ${timeStr}`);
            }

            if (seenPullIds.has(pullId)) {
                throw new Error(`Duplicate pullId detected in CSV at line ${i + 1}: ${pullId}`);
            }
            seenPullIds.add(pullId);

            // Resolve item name and type using the dictionary
            const dictEntry = srgfDict[itemId];
            let itemName = `Unknown Item (${itemId})`;
            let itemType = itemId.length === 4 ? "Character" : "Light Cone";

            if (dictEntry) {
                itemName = dictEntry.name;
                itemType = dictEntry.type;
            }

            pulls.push({
                pullId,
                bannerType,
                bannerId: bannerId || undefined,
                itemId,
                itemName,
                itemType,
                rarity,
                pulledAt,
            });
        }

        // Sort pulls chronologically (oldest-first)
        pulls.sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());

        return {
            games: [
                {
                    gameId: "starrail",
                    gameUid: "StarRailStation",
                    pulls,
                },
            ],
        };
    }
}
