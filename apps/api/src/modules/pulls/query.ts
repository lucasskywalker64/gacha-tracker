import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull } from "../../db/schema";
import { eq, and, or, lt, desc, sql } from "drizzle-orm";
import { authPlugin } from "../auth";
import { paginationSchema } from "@gacha-tracker/shared";
import { resolvePrimaryOrEarliestAccount } from "../games/account-resolver";

interface CursorData {
    pulledAt: number;
    pullId: string;
}

function decodeCursor(cursorStr?: string): CursorData | null {
    if (!cursorStr) return null;
    try {
        const json = Buffer.from(cursorStr, "base64url").toString("utf-8");
        const parsed = JSON.parse(json);
        if (typeof parsed.pulledAt === "number" && typeof parsed.pullId === "string") {
            return parsed;
        }
    } catch {
        return null;
    }
    return null;
}

function encodeCursor(pulledAt: Date | number, pullId: string): string {
    const timestamp = pulledAt instanceof Date ? pulledAt.getTime() : pulledAt;
    const payload = JSON.stringify({ pulledAt: timestamp, pullId });
    return Buffer.from(payload, "utf-8").toString("base64url");
}

export const queryRouter = new Elysia({ prefix: "/pulls" }).use(authPlugin).get(
    "/",
    async ({ query, user }) => {
        const parsed = paginationSchema.parse(query);
        const { gameId, gameUid, bannerType, cursor, page, limit, includeTotal } = parsed;
        const userId = user!.id;

        const baseConditions = [eq(pull.userId, userId), eq(pull.gameId, gameId)];

        if (gameUid && gameUid !== "all") {
            baseConditions.push(eq(pull.gameUid, gameUid));
        } else if (!gameUid) {
            // Default to user's primary or earliest game account if omitted
            const defaultAccount = await resolvePrimaryOrEarliestAccount(userId, gameId);
            if (defaultAccount) {
                baseConditions.push(eq(pull.gameUid, defaultAccount.gameUid));
            }
        }

        if (bannerType) {
            baseConditions.push(eq(pull.bannerType, bannerType));
        }

        const cursorData = decodeCursor(cursor);
        const currentCursor = cursorData ? cursor : null;
        const queryConditions = [...baseConditions];

        if (cursorData) {
            const cursorDate = new Date(cursorData.pulledAt);
            queryConditions.push(
                or(
                    lt(pull.pulledAt, cursorDate),
                    and(eq(pull.pulledAt, cursorDate), lt(pull.pullId, cursorData.pullId))
                )!
            );
        }

        const offset = !cursorData && page > 1 ? (page - 1) * limit : 0;

        const resultsQuery = db
            .select()
            .from(pull)
            .where(and(...queryConditions))
            .orderBy(desc(pull.pulledAt), desc(pull.pullId))
            .limit(limit + 1)
            .offset(offset);

        if (includeTotal) {
            const [results, [{ count }]] = await Promise.all([
                resultsQuery,
                db
                    .select({ count: sql<number>`count(*)` })
                    .from(pull)
                    .where(and(...baseConditions)),
            ]);

            const hasNextPage = results.length > limit;
            const items = hasNextPage ? results.slice(0, limit) : results;
            const nextCursor =
                hasNextPage && items.length > 0
                    ? encodeCursor(items[items.length - 1].pulledAt, items[items.length - 1].pullId)
                    : null;

            return {
                data: items,
                meta: {
                    limit,
                    page,
                    cursor: currentCursor,
                    nextCursor,
                    hasNextPage,
                    total: count,
                },
            };
        }

        const results = await resultsQuery;
        const hasNextPage = results.length > limit;
        const items = hasNextPage ? results.slice(0, limit) : results;
        const nextCursor =
            hasNextPage && items.length > 0
                ? encodeCursor(items[items.length - 1].pulledAt, items[items.length - 1].pullId)
                : null;

        return {
            data: items,
            meta: {
                limit,
                page,
                cursor: currentCursor,
                nextCursor,
                hasNextPage,
            },
        };
    },
    { auth: true }
);
