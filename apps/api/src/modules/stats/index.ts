import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { userGame, type FiveStarHistoryItem } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { authPlugin } from "../auth";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";

type StatsHistoryItem = FiveStarHistoryItem & { id: string };

export const statsRouter = new Elysia({ prefix: "/stats" }).use(authPlugin).get(
    "/:gameId",
    async ({ params, query, user, status }) => {
        const { gameId } = params;
        const gameUid = query?.gameUid;
        const userId = user!.id;

        if (gameUid && gameUid !== "all") {
            const cacheKey = RedisKeys.stats(userId, gameId, gameUid);
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return JSON.parse(cached);
            } catch {
                // Redis failure is non-fatal
            }
        } else if (gameUid === "all") {
            const cacheKey = RedisKeys.stats(userId, gameId, "all");
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return JSON.parse(cached);
            } catch {
                // Redis failure is non-fatal
            }
        }

        const userGameRows = await db
            .select()
            .from(userGame)
            .where(and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)));

        if (userGameRows.length === 0) {
            if (gameUid && gameUid !== "all") {
                return status(404, { error: "Game account not found" });
            }
            const emptyStats = {
                total: 0,
                fiveStars: 0,
                fourStars: 0,
                currentPity: {},
                fiveStarHistory: [],
            };
            const cacheKey = RedisKeys.stats(userId, gameId, gameUid ?? "all");
            try {
                await redis.set(cacheKey, JSON.stringify(emptyStats), "EX", 300);
            } catch {
                // Redis failure is non-fatal
            }
            return emptyStats;
        }

        let targetRows: typeof userGameRows;
        let cacheKey: string;

        if (gameUid && gameUid !== "all") {
            const matched = userGameRows.find((r) => r.gameUid === gameUid);
            if (!matched) {
                return status(404, { error: "Game account not found" });
            }
            targetRows = [matched];
            cacheKey = RedisKeys.stats(userId, gameId, gameUid);
        } else if (gameUid === "all") {
            targetRows = userGameRows;
            cacheKey = RedisKeys.stats(userId, gameId, "all");
        } else {
            const primary = userGameRows.find((r) => r.isPrimary) ?? userGameRows[0];
            targetRows = [primary];
            cacheKey = RedisKeys.stats(userId, gameId, primary.gameUid);
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return JSON.parse(cached);
            } catch {
                // Redis failure is non-fatal
            }
        }

        let stats: {
            total: number;
            fiveStars: number;
            fourStars: number;
            currentPity: Record<string, number>;
            fiveStarHistory: Array<{
                id: string;
                pullId: string;
                gameUid: string;
                itemId: string;
                itemName: string;
                pityAtPull: number;
                wasGuaranteed: number;
                pulledAt: number;
                bannerType: string;
                bannerId?: string | null;
            }>;
        };

        if (targetRows.length === 1) {
            const row = targetRows[0];
            const currentPity = row.statsCurrentPity ?? {};
            const fiveStarHistory = row.statsFiveStarHistory ?? [];

            stats = {
                total: row.statsTotalPulls,
                fiveStars: row.statsFiveStars,
                fourStars: row.statsFourStars,
                currentPity,
                fiveStarHistory: fiveStarHistory.map((item) => ({
                    ...item,
                    id: `${item.gameUid}:${item.pullId}`,
                    pullId: item.pullId,
                })),
            };
        } else {
            let total = 0;
            let fiveStars = 0;
            let fourStars = 0;
            const historyMap = new Map<string, StatsHistoryItem>();

            for (const row of targetRows) {
                total += row.statsTotalPulls;
                fiveStars += row.statsFiveStars;
                fourStars += row.statsFourStars;
                if (row.statsFiveStarHistory) {
                    for (const item of row.statsFiveStarHistory) {
                        const compositeKey = `${item.gameUid}:${item.pullId}`;
                        historyMap.set(compositeKey, {
                            ...item,
                            id: compositeKey,
                            pullId: item.pullId,
                        });
                    }
                }
            }

            const primaryRow = targetRows.find((r) => r.isPrimary) ?? targetRows[0];
            const currentPity = primaryRow.statsCurrentPity ?? {};

            const sortedHistory = Array.from(historyMap.values()).sort(
                (a, b) => b.pulledAt - a.pulledAt
            );

            stats = {
                total,
                fiveStars,
                fourStars,
                currentPity,
                fiveStarHistory: sortedHistory,
            };
        }

        try {
            await redis.set(cacheKey, JSON.stringify(stats), "EX", 300);
        } catch {
            // Redis failure is non-fatal
        }

        return stats;
    },
    {
        auth: true,
        params: t.Object({
            gameId: t.String(),
        }),
        query: t.Optional(
            t.Object({
                gameUid: t.Optional(t.String()),
            })
        ),
    }
);
