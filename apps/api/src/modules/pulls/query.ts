import { Elysia } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, or, lt, desc, sql } from "drizzle-orm";
import { authPlugin } from "../auth";
import { paginationSchema } from "@gacha-tracker/shared";
import { resolvePrimaryOrEarliestAccount } from "../games/account-resolver";

interface CursorData {
    pulledAt: number;
    pullId: string;
    gameUid?: string;
}

function decodeCursor(cursorStr?: string): CursorData | null {
    if (!cursorStr) return null;
    try {
        const json = Buffer.from(cursorStr, "base64url").toString("utf-8");
        const parsed = JSON.parse(json);
        if (typeof parsed.pulledAt === "number" && typeof parsed.pullId === "string") {
            return {
                pulledAt: parsed.pulledAt,
                pullId: parsed.pullId,
                gameUid: typeof parsed.gameUid === "string" ? parsed.gameUid : undefined,
            };
        }
    } catch {
        return null;
    }
    return null;
}

function encodeCursor(pulledAt: Date | number, pullId: string, gameUid?: string): string {
    const timestamp = pulledAt instanceof Date ? pulledAt.getTime() : pulledAt;
    const payload = JSON.stringify({
        pulledAt: timestamp,
        pullId,
        ...(gameUid ? { gameUid } : {}),
    });
    return Buffer.from(payload, "utf-8").toString("base64url");
}

export const queryRouter = new Elysia({ prefix: "/pulls" }).use(authPlugin).get(
    "/",
    async ({ query, user }) => {
        const parsed = paginationSchema.parse(query);
        const { gameId, gameUid, bannerType, cursor, page, limit, includeTotal } = parsed;
        const userId = user!.id;

        const baseConditions = [eq(pull.userId, userId), eq(pull.gameId, gameId)];
        let effectiveGameUid = gameUid;

        if (gameUid && gameUid !== "all") {
            baseConditions.push(eq(pull.gameUid, gameUid));
        } else if (!gameUid) {
            // Default to user's primary or earliest game account if omitted
            const defaultAccount = await resolvePrimaryOrEarliestAccount(userId, gameId);
            if (defaultAccount) {
                effectiveGameUid = defaultAccount.gameUid;
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
            const tieBreak = cursorData.gameUid
                ? or(
                      lt(pull.pullId, cursorData.pullId),
                      and(eq(pull.pullId, cursorData.pullId), lt(pull.gameUid, cursorData.gameUid))
                  )
                : lt(pull.pullId, cursorData.pullId);

            queryConditions.push(
                or(lt(pull.pulledAt, cursorDate), and(eq(pull.pulledAt, cursorDate), tieBreak!))!
            );
        }

        const offset = !cursorData && page > 1 ? (page - 1) * limit : 0;

        const resultsQuery = db
            .select()
            .from(pull)
            .where(and(...queryConditions))
            .orderBy(desc(pull.pulledAt), desc(pull.pullId), desc(pull.gameUid))
            .limit(limit + 1)
            .offset(offset);

        if (includeTotal) {
            let totalPromise: Promise<number>;
            if (!bannerType) {
                // When bannerType is not filtered, total pulls is already materialized on user_game
                if (effectiveGameUid && effectiveGameUid !== "all") {
                    totalPromise = db
                        .select({ count: userGame.statsTotalPulls })
                        .from(userGame)
                        .where(
                            and(
                                eq(userGame.userId, userId),
                                eq(userGame.gameId, gameId),
                                eq(userGame.gameUid, effectiveGameUid)
                            )
                        )
                        .then((rows) => rows[0]?.count ?? 0);
                } else {
                    totalPromise = db
                        .select({
                            count: sql<number>`coalesce(sum(${userGame.statsTotalPulls}), 0)`,
                        })
                        .from(userGame)
                        .where(and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)))
                        .then((rows) => Number(rows[0]?.count ?? 0));
                }
            } else {
                totalPromise = db
                    .select({ count: sql<number>`count(*)` })
                    .from(pull)
                    .where(and(...baseConditions))
                    .then((rows) => rows[0]?.count ?? 0);
            }

            const [results, count] = await Promise.all([resultsQuery, totalPromise]);

            const hasNextPage = results.length > limit;
            const items = hasNextPage ? results.slice(0, limit) : results;
            const nextCursor =
                hasNextPage && items.length > 0
                    ? encodeCursor(
                          items[items.length - 1].pulledAt,
                          items[items.length - 1].pullId,
                          items[items.length - 1].gameUid
                      )
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
                ? encodeCursor(
                      items[items.length - 1].pulledAt,
                      items[items.length - 1].pullId,
                      items[items.length - 1].gameUid
                  )
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
