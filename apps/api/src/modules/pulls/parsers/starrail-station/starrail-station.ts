import { srgfDict } from "@gacha-tracker/shared";
import type {
    ImportParser,
    ParsedGamePulls,
    ParsedImportResult,
    ParsedPull,
    ParseContext,
} from "../types";
import { decompressFromUTF16 } from "./lz-string-safe";
import { z } from "zod";

const datWarpItemSchema = z.object({
    uid: z.union([z.string(), z.number()]),
    itemId: z.union([z.string(), z.number()]),
    rarity: z.number().int(),
    timestamp: z.number().int(),
    gachaType: z.number().int(),
});

const datWarpStoreSchema = z
    .object({
        items_1: z.array(datWarpItemSchema).optional(),
        items_2: z.array(datWarpItemSchema).optional(),
        items_11: z.array(datWarpItemSchema).optional(),
        items_12: z.array(datWarpItemSchema).optional(),
        items_21: z.array(datWarpItemSchema).optional(),
        items_22: z.array(datWarpItemSchema).optional(),
    })
    .catchall(z.unknown());

const starRailStationDatSchema = z.object({
    profiles: z
        .record(
            z.string(),
            z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                key: z.string().optional(),
            })
        )
        .optional(),
    data: z
        .object({
            stores: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
});

export class StarRailStationParser implements ImportParser {
    formatId = "starrail-station";
    displayName = "Star Rail Station Backup";
    acceptedExtensions = ".csv,.dat";

    // Safety limit in characters, exposed for configuration and testing
    maxDecompressedLength = 20 * 1024 * 1024;

    async parse(buffer: Buffer, context?: ParseContext): Promise<ParsedImportResult> {
        // Detect format: DAT files always start with 'srs'
        const isDat = buffer.subarray(0, 3).toString("utf-8") === "srs";

        if (isDat) {
            return this.parseDat(buffer, context);
        } else {
            return this.parseCsv(buffer, context);
        }
    }

    private parseDat(buffer: Buffer, context?: ParseContext): ParsedImportResult {
        const payloadStr = buffer.subarray(3).toString("utf-8");
        const decompressed = decompressFromUTF16(payloadStr, this.maxDecompressedLength);
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

        const parsed = starRailStationDatSchema.safeParse(root);
        if (!parsed.success) {
            throw new Error("Invalid Star Rail Station backup structure: " + parsed.error.message);
        }

        const stores = parsed.data.data?.stores;
        if (!stores) {
            throw new Error("Star Rail Station backup does not contain warp history data");
        }

        // Determine all profiles in the backup
        const profilesMap = parsed.data.profiles || { "1": { name: "Default", key: "1" } };
        const profileEntries = Object.entries(profilesMap);

        // Pre-scan stores to identify which profiles have warp data
        const activeProfiles: Array<{
            key: string;
            name: string;
            warpStore: z.infer<typeof datWarpStoreSchema>;
        }> = [];

        for (const [key, profileObj] of profileEntries) {
            const storeKey = `${key}_warp-v2`;
            const rawStore = stores[storeKey];
            if (!rawStore) continue;

            const validatedStore = datWarpStoreSchema.safeParse(rawStore);
            if (!validatedStore.success) continue;

            const warpStore = validatedStore.data;
            const hasPulls =
                (warpStore.items_1?.length || 0) +
                    (warpStore.items_2?.length || 0) +
                    (warpStore.items_11?.length || 0) +
                    (warpStore.items_12?.length || 0) +
                    (warpStore.items_21?.length || 0) +
                    (warpStore.items_22?.length || 0) >
                0;

            if (hasPulls) {
                activeProfiles.push({
                    key,
                    name: profileObj.name || (key === "1" ? "Default" : `Profile ${key}`),
                    warpStore,
                });
            }
        }

        if (activeProfiles.length === 0) {
            throw new Error("Star Rail Station backup does not contain warp history data");
        }

        const games: ParsedGamePulls[] = [];
        const itemKeys = [
            "items_1",
            "items_2",
            "items_11",
            "items_12",
            "items_21",
            "items_22",
        ] as const;

        for (const profile of activeProfiles) {
            // Find UID for this profile:
            // 1. check context.profileUids[profile.key]
            // 2. check context.profileUids[profile.name]
            // 3. if only 1 active profile in total, fallback to context.gameUid
            const assignedUid =
                context?.profileUids?.[profile.key]?.trim() ||
                context?.profileUids?.[profile.name]?.trim() ||
                (activeProfiles.length === 1 ? context?.gameUid?.trim() : undefined);

            if (!assignedUid) {
                throw new Error(
                    `A Honkai: Star Rail UID is required for profile "${profile.name}". Please provide a UID.`
                );
            }

            if (!/^\d{9}$/.test(assignedUid)) {
                throw new Error(
                    `Invalid Honkai: Star Rail UID "${assignedUid}" for profile "${profile.name}". A standard UID is 9 digits.`
                );
            }

            const pulls: ParsedPull[] = [];
            const seenPullIds = new Set<string>();

            for (const key of itemKeys) {
                const items = profile.warpStore[key];
                if (!items) continue;

                for (let idx = 0; idx < items.length; idx++) {
                    const item = items[idx];
                    const pullId = String(item.uid);
                    const itemId = String(item.itemId);
                    const rarity = item.rarity;
                    const timestamp = item.timestamp;
                    const rawGachaType = item.gachaType;

                    // Map SRS internal rerun gacha types (21, 22) back to official Hoyoverse types (11, 12)
                    let bannerType = String(rawGachaType);
                    if (bannerType === "21") bannerType = "11";
                    if (bannerType === "22") bannerType = "12";

                    const pulledAt = new Date(timestamp);
                    if (isNaN(pulledAt.getTime())) {
                        throw new Error(
                            `Invalid timestamp detected in backup for profile "${profile.name}" at ${key} index ${idx}`
                        );
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

            games.push({
                gameId: "starrail",
                gameUid: assignedUid,
                nickname: profile.name !== "Default" ? profile.name : null,
                pulls,
            });
        }

        return { games };
    }

    private parseCsv(buffer: Buffer, context?: ParseContext): ParsedImportResult {
        const gameUid =
            context?.gameUid?.trim() ||
            context?.profileUids?.["1"]?.trim() ||
            context?.profileUids?.default?.trim();
        if (!gameUid) {
            throw new Error(
                "A Honkai: Star Rail UID is required to import Star Rail Station CSV files. Please provide your UID."
            );
        }

        if (!/^\d{9}$/.test(gameUid)) {
            throw new Error("Invalid Honkai: Star Rail UID. A standard UID is 9 digits.");
        }

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
                throw new Error(
                    `Malformed CSV row at line ${i + 1}: expected ${headers.length} columns, got ${parts.length}`
                );
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
                    gameUid,
                    pulls,
                },
            ],
        };
    }
}
