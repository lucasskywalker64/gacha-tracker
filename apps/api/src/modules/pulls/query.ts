import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, desc, sql, asc } from "drizzle-orm";
import { authPlugin } from "../auth";
import { paginationSchema } from "@gacha-tracker/shared";

export const queryRouter = new Elysia({ prefix: "/pulls" }).use(authPlugin).get(
    "/",
    async ({ query, user }) => {
        const parsed = paginationSchema.parse(query);
        const { gameId, gameUid, bannerType, page, limit } = parsed;
        const offset = (page - 1) * limit;
        const userId = user!.id;

        const conditions = [eq(pull.userId, userId), eq(pull.gameId, gameId)];

        if (gameUid && gameUid !== "all") {
            conditions.push(eq(pull.gameUid, gameUid));
        } else if (!gameUid) {
            // Default to user's primary game account if omitted
            const primaryAccount = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.isPrimary, true)
                ),
            });

            if (primaryAccount) {
                conditions.push(eq(pull.gameUid, primaryAccount.gameUid));
            } else {
                const anyAccount = await db.query.userGame.findFirst({
                    where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
                    orderBy: [asc(userGame.createdAt)],
                });
                if (anyAccount) {
                    conditions.push(eq(pull.gameUid, anyAccount.gameUid));
                }
            }
        }

        if (bannerType) {
            conditions.push(eq(pull.bannerType, bannerType));
        }

        const results = await db
            .select()
            .from(pull)
            .where(and(...conditions))
            .orderBy(desc(pull.pulledAt), desc(pull.pullId))
            .limit(limit + 1)
            .offset(offset);

        const hasNextPage = results.length > limit;
        const items = hasNextPage ? results.slice(0, limit) : results;

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(pull)
            .where(and(...conditions));

        return {
            data: items,
            meta: {
                page,
                limit,
                hasNextPage,
                total: count,
            },
        };
    },
    { auth: true }
);
