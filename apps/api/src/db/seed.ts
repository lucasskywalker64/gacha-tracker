import { db } from "./client";
import { game } from "./schema/game";
import { featureFlag } from "./schema/feature-flag";

/**
 * Seeds the database with the supported games and default feature flags.
 *
 * This is idempotent and will not overwrite existing entries.
 */
export async function runSeed() {
    console.log("⏳ Seeding database...");

    const supportedGames = [
        { id: "starrail", displayName: "Honkai: Star Rail", isActive: 1 },
        { id: "genshin", displayName: "Genshin Impact", isActive: 1 },
        { id: "zzz", displayName: "Zenless Zone Zero", isActive: 1 },
        { id: "wuwa", displayName: "Wuthering Waves", isActive: 1 },
    ];

    const defaultFlags = [
        { key: "starrail", enabled: 1 },
        { key: "genshin", enabled: 1 },
        { key: "zzz", enabled: 1 },
        { key: "wuwa", enabled: 1 },
        { key: "anonymousAccounts", enabled: 1 },
        { key: "experimentalLuckScore", enabled: 0 },
    ];

    try {
        for (const g of supportedGames) {
            await db.insert(game).values(g).onConflictDoNothing({ target: game.id });
        }

        for (const flag of defaultFlags) {
            await db
                .insert(featureFlag)
                .values(flag)
                .onConflictDoNothing({ target: featureFlag.key });
        }

        console.log("✅ Seeding completed");
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        throw error;
    }
}
