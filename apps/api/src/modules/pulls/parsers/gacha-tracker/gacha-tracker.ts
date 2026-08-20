import { nativeExportSchema } from "@gacha-tracker/shared";
import type { ImportParser, ParsedImportResult } from "../types";

export class GachaTrackerParser implements ImportParser {
    formatId = "gacha-tracker";
    displayName = "Gacha Tracker Backup";
    acceptedExtensions = ".json";

    async parse(buffer: Buffer): Promise<ParsedImportResult> {
        const text = buffer.toString("utf-8");
        const json = JSON.parse(text);

        // Validate JSON using nativeExportSchema
        const validated = nativeExportSchema.parse(json);

        return {
            fileVersion: validated.version ? String(validated.version) : undefined,
            games: validated.games.flatMap((g) =>
                g.accounts.map((acc) => ({
                    gameId: g.gameId,
                    gameUid: acc.gameUid,
                    nickname: acc.nickname ?? undefined,
                    pulls: acc.pulls.map((p) => ({
                        pullId: p.pullId,
                        bannerType: p.bannerType,
                        bannerId: p.bannerId || undefined,
                        itemId: p.itemId,
                        itemName: p.itemName,
                        itemType: p.itemType,
                        rarity: p.rarity,
                        pulledAt: new Date(p.pulledAt),
                    })),
                }))
            ),
        };
    }
}
