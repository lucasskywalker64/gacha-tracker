import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull } from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authPlugin } from "../auth";
import { paginationSchema } from "@gacha-tracker/shared";
import { resolvePrimaryOrEarliestAccount } from "../games/account-resolver";

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
            // Default to user's primary or earliest game account if omitted
            const defaultAccount = await resolvePrimaryOrEarliestAccount(userId, gameId);
            if (defaultAccount) {
                conditions.push(eq(pull.gameUid, defaultAccount.gameUid));
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
