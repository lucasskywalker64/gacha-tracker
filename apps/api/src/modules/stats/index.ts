import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { authPlugin } from "../auth";
import { redis } from "../../lib/redis";

export const statsRouter = new Elysia({ prefix: "/stats" }).use(authPlugin).get(
    "/:gameId",
    async ({ params, user }) => {
        const { gameId } = params;
        const userId = user!.id;

        const cacheKey = `stats:${userId}:${gameId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

        const allPulls = await db
            .select()
            .from(pull)
            .where(and(eq(pull.userId, userId), eq(pull.gameId, gameId)));

        const stats = {
            total: allPulls.length,
            fiveStars: 0,
            fourStars: 0,
            currentPity: {} as Record<string, number>,
            fiveStarHistory: [] as {
                id: string;
                itemId: string;
                itemName: string;
                pityAtPull: number;
                wasGuaranteed: number;
                pulledAt: number;
                bannerType: string;
                bannerId?: string | null;
            }[], // Explicitly typed array of recent 5 stars
        };

        const pityTracker: Record<string, number> = {};

        for (const pull of allPulls) {
            if (pull.rarity === 5) {
                stats.fiveStars++;
                stats.fiveStarHistory.push({
                    id: pull.id,
                    itemId: pull.itemId,
                    itemName: pull.itemName,
                    pityAtPull: pull.pityAtPull,
                    wasGuaranteed: pull.wasGuaranteed,
                    pulledAt: pull.pulledAt.getTime(),
                    bannerType: pull.bannerType,
                    bannerId: pull.bannerId,
                });
                pityTracker[pull.bannerType] = 0; // reset
            } else if (pull.rarity === 4) {
                stats.fourStars++;
                pityTracker[pull.bannerType] = (pityTracker[pull.bannerType] || 0) + 1;
            } else {
                pityTracker[pull.bannerType] = (pityTracker[pull.bannerType] || 0) + 1;
            }
        }

        // We actually want the current pity from the most recent pulls per banner
        // Since allPulls isn't sorted implicitly here, we should sort them
        allPulls.sort((a, b) => {
            if (a.pulledAt.getTime() === b.pulledAt.getTime()) {
                return a.pullId.localeCompare(b.pullId);
            }
            return a.pulledAt.getTime() - b.pulledAt.getTime();
        });

        const currentPityExact: Record<string, number> = {};

        for (const pull of allPulls) {
            if (pull.rarity === 5) {
                currentPityExact[pull.bannerType] = 0;
            } else {
                currentPityExact[pull.bannerType] = (currentPityExact[pull.bannerType] || 0) + 1;
            }
        }

        stats.currentPity = currentPityExact;

        // Keep only recent 5 stars if too many (or keep them all for dashboard)
        stats.fiveStarHistory.sort((a, b) => b.pulledAt - a.pulledAt);

        await redis.set(cacheKey, JSON.stringify(stats), "EX", 60 * 5); // cache for 5 minutes
        return stats;
    },
    { auth: true }
);
