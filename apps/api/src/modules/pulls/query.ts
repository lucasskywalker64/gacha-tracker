import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull } from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authPlugin } from "../auth";
import { paginationSchema } from "@gacha-tracker/shared";

export const queryRouter = new Elysia({ prefix: "/pulls" }).use(authPlugin).get(
    "/",
    async ({ query, user }) => {
        const parsed = paginationSchema.parse(query);
        const { gameId, bannerType, page, limit } = parsed;
        const offset = (page - 1) * limit;

        const conditions = [eq(pull.userId, user!.id), eq(pull.gameId, gameId)];

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
        const items = (hasNextPage ? results.slice(0, limit) : results).map((p) => ({
            ...p,
            extra: p.extra
                ? (() => {
                      try {
                          return JSON.parse(p.extra);
                      } catch {
                          return null;
                      }
                  })()
                : null,
        }));

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
