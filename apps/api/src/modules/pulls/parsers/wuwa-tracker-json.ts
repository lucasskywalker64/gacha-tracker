import { z } from "zod";
import type { ImportParser, ParsedImportResult } from "./types";

// Schema for individual WuWaTracker pull record
const wuwaTrackerPullSchema = z.object({
    cardPoolType: z.number().int(),
    resourceId: z.number().int(),
    qualityLevel: z.number().int(),
    name: z.string().min(1),
    time: z.iso.datetime({ offset: true }),
    isSorted: z.boolean().optional(),
    group: z.number().int().min(1).default(1),
});

// Schema for WuWaTracker export file structure
const wuwaTrackerExportSchema = z.object({
    siteVersion: z.string().optional(),
    version: z.string().optional(),
    date: z.string().optional(),
    playerId: z.string().min(1),
    pulls: z.array(wuwaTrackerPullSchema),
});

export class WuWaTrackerJsonParser implements ImportParser {
    formatId = "wuwa-tracker-json";
    displayName = "WuWaTracker Export";
    acceptedExtensions = ".json";

    async parse(buffer: Buffer): Promise<ParsedImportResult> {
        const text = buffer.toString("utf-8");
        const json = JSON.parse(text);

        // Validate the export structure using Zod
        const validated = wuwaTrackerExportSchema.parse(json);
        const gameUid = validated.playerId;

        // Group and reverse the pulls to restore chronological order (oldest-first)
        // since WuWaTracker stores them newest-first.
        const rawPulls = [...validated.pulls].reverse();
        const seenPullIds = new Set<string>();

        const pulls = rawPulls.map((p) => {
            const date = new Date(p.time);

            // Generate clean UTC time representation: YYYY-MM-DD-HH-mm-ss
            const cleanTime = date
                .toISOString()
                .replace(/T/, " ")
                .replace(/\..+/, "")
                .replace(/[\s:]/g, "-");

            const bannerType = String(p.cardPoolType);
            const itemId = String(p.resourceId);
            const indexWithinSecond = p.group - 1;

            // Stable and deterministic pullId matching extract.ps1
            const pullId = `${gameUid}_${bannerType}_${cleanTime}_${indexWithinSecond}`;

            if (seenPullIds.has(pullId)) {
                throw new Error(`Duplicate pullId collision detected in import file: ${pullId}`);
            }
            seenPullIds.add(pullId);

            // Resolve itemType based on resourceId length convention (4 digits = Resonator, 8 digits = Weapon)
            let itemType: string;
            if (itemId.length === 4) {
                itemType = "Resonator";
            } else if (itemId.length === 8) {
                itemType = "Weapon";
            } else {
                throw new Error(`Unknown resourceId format/length detected: ${itemId}`);
            }

            return {
                pullId,
                bannerType,
                itemId,
                itemName: p.name,
                itemType,
                rarity: p.qualityLevel,
                pulledAt: date,
            };
        });

        return {
            games: [
                {
                    gameId: "wuwa",
                    gameUid,
                    pulls,
                },
            ],
        };
    }
}
