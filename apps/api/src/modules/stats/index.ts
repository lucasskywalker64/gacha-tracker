import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, asc } from "drizzle-orm";
import { authPlugin } from "../auth";
import { redis } from "../../lib/redis";
import { getAdapter } from "../games/registry";

export const statsRouter = new Elysia({ prefix: "/stats" }).use(authPlugin).get(
    "/:gameId",
    async ({ params, query, user, status }) => {
        const { gameId } = params;
        const gameUid = query?.gameUid;
        const userId = user!.id;

        let cacheKey: string;
        const conditions = [eq(pull.userId, userId), eq(pull.gameId, gameId)];

        if (gameUid && gameUid !== "all") {
            const owned = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.gameUid, gameUid)
                ),
            });
            if (!owned) {
                return status(404, { error: "Game account not found" });
            }
            cacheKey = `stats:${userId}:${gameId}:${gameUid}`;
            conditions.push(eq(pull.gameUid, gameUid));
        } else if (gameUid === "all") {
            cacheKey = `stats:${userId}:${gameId}:all`;
        } else {
            // Default to primary game account if omitted
            const primaryAccount = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.isPrimary, true)
                ),
            });

            if (primaryAccount) {
                cacheKey = `stats:${userId}:${gameId}:${primaryAccount.gameUid}`;
                conditions.push(eq(pull.gameUid, primaryAccount.gameUid));
            } else {
                const anyAccount = await db.query.userGame.findFirst({
                    where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
                    orderBy: [asc(userGame.createdAt)],
                });

                if (anyAccount) {
                    cacheKey = `stats:${userId}:${gameId}:${anyAccount.gameUid}`;
                    conditions.push(eq(pull.gameUid, anyAccount.gameUid));
                } else {
                    cacheKey = `stats:${userId}:${gameId}:all`;
                }
            }
        }

        const cached = await redis.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }

        const allPulls = await db
            .select()
            .from(pull)
            .where(and(...conditions));

        const stats = {
            total: allPulls.length,
            fiveStars: 0,
            fourStars: 0,
            currentPity: {} as Record<string, number>,
            fiveStarHistory: [] as {
                id: string;
                gameUid: string;
                itemId: string;
                itemName: string;
                pityAtPull: number;
                wasGuaranteed: number;
                pulledAt: number;
                bannerType: string;
                bannerId?: string | null;
            }[], // Explicitly typed array of recent 5 stars
        };

        for (const pull of allPulls) {
            if (pull.rarity === 5) {
                stats.fiveStars++;
                stats.fiveStarHistory.push({
                    id: pull.id,
                    gameUid: pull.gameUid,
                    itemId: pull.itemId,
                    itemName: pull.itemName,
                    pityAtPull: pull.pityAtPull,
                    wasGuaranteed: pull.wasGuaranteed,
                    pulledAt: pull.pulledAt.getTime(),
                    bannerType: pull.bannerType,
                    bannerId: pull.bannerId,
                });
            } else if (pull.rarity === 4) {
                stats.fourStars++;
            }
        }

        // Determine which pulls to use for current pity calculation.
        // When aggregated (gameUid === 'all'), calculate current pity for the primary account
        // to avoid corrupting pity counters across separate in-game accounts.
        let pityPulls = allPulls;
        if (gameUid === "all") {
            const primaryAccount = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.isPrimary, true)
                ),
            });

            let targetUid = primaryAccount?.gameUid;
            if (!targetUid) {
                const anyAccount = await db.query.userGame.findFirst({
                    where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
                    orderBy: [asc(userGame.createdAt)],
                });
                targetUid = anyAccount?.gameUid;
            }

            if (targetUid) {
                pityPulls = allPulls.filter((p) => p.gameUid === targetUid);
            }
        }

        const comparePullId = (a: string, b: string) =>
            a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length - b.length;

        // Sort pulls chronologically
        const sortedPityPulls = [...pityPulls].sort((a, b) => {
            const delta = a.pulledAt.getTime() - b.pulledAt.getTime();
            if (delta !== 0) return delta;
            return comparePullId(a.pullId, b.pullId);
        });

        let adapter;
        try {
            adapter = getAdapter(gameId);
        } catch {
            // Adapter not registered
        }

        const pityTriggerRarity = adapter?.pityConfig?.pityTriggerRarity ?? 5;
        const pityByPool: Record<string, number> = {};

        for (const p of sortedPityPulls) {
            const poolKey = adapter?.pityPools?.[p.bannerType] || p.bannerType;
            if (p.rarity === pityTriggerRarity) {
                pityByPool[poolKey] = 0;
            } else {
                pityByPool[poolKey] = (pityByPool[poolKey] || 0) + 1;
            }
        }

        const currentPityExact: Record<string, number> = {};
        if (sortedPityPulls.length > 0) {
            const bannerTypes = adapter?.bannerTypes || Object.keys(pityByPool);
            for (const bannerType of bannerTypes) {
                const poolKey = adapter?.pityPools?.[bannerType] || bannerType;
                currentPityExact[bannerType] = pityByPool[poolKey] || 0;
            }

            for (const [poolKey, count] of Object.entries(pityByPool)) {
                if (currentPityExact[poolKey] === undefined) {
                    currentPityExact[poolKey] = count;
                }
            }
        }

        stats.currentPity = currentPityExact;

        // Keep only recent 5 stars sorted descending
        stats.fiveStarHistory.sort((a, b) => b.pulledAt - a.pulledAt);

        await redis.set(cacheKey, JSON.stringify(stats), "EX", 60 * 5); // cache for 5 minutes
        return stats;
    },
    {
        auth: true,
        query: t.Optional(
            t.Object({
                gameUid: t.Optional(t.String()),
            })
        ),
    }
);
