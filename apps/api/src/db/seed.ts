import { db } from "./client";
import { game } from "./schema/game";

/**
 * Seeds the database with the supported games.
 *
 * This is idempotent and will not overwrite existing games.
 */
export async function runSeed() {
    console.log("⏳ Seeding database...");

    const supportedGames = [
        { id: "starrail", displayName: "Honkai: Star Rail", isActive: 1 },
        { id: "genshin", displayName: "Genshin Impact", isActive: 1 },
        { id: "zzz", displayName: "Zenless Zone Zero", isActive: 1 },
        { id: "wuwa", displayName: "Wuthering Waves", isActive: 1 },
    ];

    try {
        for (const g of supportedGames) {
            await db.insert(game).values(g).onConflictDoNothing({ target: game.id });
        }

        console.log("✅ Seeding completed");
    } catch (error) {
        console.error("❌ Seeding failed:", error);
    }
}
