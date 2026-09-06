import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame, user as userTable } from "../../db/schema";
import { eq, and, desc, asc, ne } from "drizzle-orm";
import { authPlugin } from "../auth";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";

export const accountsRouter = new Elysia()
    .use(authPlugin)
    .guard({ auth: true })

    // GET /games/:gameId/accounts - List all registered game accounts (UIDs) for the user
    .get(
        "/games/:gameId/accounts",
        async ({ user, params: { gameId }, status }) => {
            const userId = user!.id;

            const accounts = await db
                .select({
                    id: userGame.id,
                    userId: userGame.userId,
                    gameId: userGame.gameId,
                    gameUid: userGame.gameUid,
                    nickname: userGame.nickname,
                    isPrimary: userGame.isPrimary,
                    lastImport: userGame.lastImport,
                    createdAt: userGame.createdAt,
                })
                .from(userGame)
                .where(and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)))
                .orderBy(desc(userGame.isPrimary), asc(userGame.createdAt));

            return status(200, {
                accounts: accounts.map((acc) => ({
                    id: acc.id,
                    userId: acc.userId,
                    gameId: acc.gameId,
                    gameUid: acc.gameUid,
                    nickname: acc.nickname ?? null,
                    isPrimary: Boolean(acc.isPrimary),
                    lastImport: acc.lastImport,
                    createdAt: acc.createdAt,
                })),
            });
        },
        {
            params: t.Object({
                gameId: t.String(),
            }),
            response: {
                200: t.Object({
                    accounts: t.Array(
                        t.Object({
                            id: t.String(),
                            userId: t.String(),
                            gameId: t.String(),
                            gameUid: t.String(),
                            nickname: t.Union([t.String(), t.Null()]),
                            isPrimary: t.Boolean(),
                            lastImport: t.Union([t.Date(), t.Null()]),
                            createdAt: t.Date(),
                        })
                    ),
                }),
            },
        }
    )

    // PATCH /games/:gameId/accounts/:gameUid - Update account nickname or toggle primary status
    .patch(
        "/games/:gameId/accounts/:gameUid",
        async ({ user, params: { gameId, gameUid }, body, status }) => {
            const userId = user!.id;

            const existingAccount = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.gameUid, gameUid)
                ),
            });

            if (!existingAccount) {
                return status(404, {
                    success: false,
                    error: "Game account not found",
                });
            }

            await db.transaction(async (tx) => {
                if (body.isPrimary === true) {
                    if (!existingAccount.isPrimary) {
                        // Unset previous primary account only if one exists
                        await tx
                            .update(userGame)
                            .set({ isPrimary: false })
                            .where(
                                and(
                                    eq(userGame.userId, userId),
                                    eq(userGame.gameId, gameId),
                                    eq(userGame.isPrimary, true),
                                    ne(userGame.id, existingAccount.id)
                                )
                            );

                        await tx
                            .update(userGame)
                            .set({
                                isPrimary: true,
                                ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
                            })
                            .where(eq(userGame.id, existingAccount.id));
                    } else if (body.nickname !== undefined) {
                        await tx
                            .update(userGame)
                            .set({ nickname: body.nickname })
                            .where(eq(userGame.id, existingAccount.id));
                    }
                } else if (body.nickname !== undefined) {
                    await tx
                        .update(userGame)
                        .set({ nickname: body.nickname })
                        .where(eq(userGame.id, existingAccount.id));
                }
            });

            // Flush Redis cache for stats
            await redis.del(RedisKeys.stats(userId, gameId));
            await redis.del(RedisKeys.stats(userId, gameId, "all"));
            await redis.del(RedisKeys.stats(userId, gameId, gameUid));

            return status(200, { success: true });
        },
        {
            params: t.Object({
                gameId: t.String(),
                gameUid: t.String(),
            }),
            body: t.Object({
                nickname: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
                isPrimary: t.Optional(t.Literal(true)),
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                }),
                404: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    )

    // DELETE /games/:gameId/accounts/:gameUid - Remove a game account and cascade-delete its pull history
    .delete(
        "/games/:gameId/accounts/:gameUid",
        async ({ user, params: { gameId, gameUid }, body, status }) => {
            const userId = user!.id;

            const existingAccount = await db.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.gameUid, gameUid)
                ),
                columns: { id: true },
            });

            if (!existingAccount) {
                return status(404, {
                    success: false,
                    error: "Game account not found",
                });
            }

            const userRecord = await db.query.user.findFirst({
                where: eq(userTable.id, userId),
            });
            if (!userRecord) {
                return status(404, {
                    success: false,
                    error: "User not found",
                });
            }

            if (userRecord.isAnonymous) {
                if (!userRecord.codeHash) {
                    return status(400, {
                        success: false,
                        error: "No account code is set for this anonymous account.",
                    });
                }
                if (!body?.code) {
                    return status(400, {
                        success: false,
                        error: "Account code is required to purge profile data.",
                    });
                }
                const isValid = await Bun.password.verify(body.code, userRecord.codeHash);
                if (!isValid) {
                    return status(400, {
                        success: false,
                        error: "The entered account code is incorrect.",
                    });
                }
            } else {
                const target = `${gameId}:${gameUid}`;
                const verifiedKey = RedisKeys.sensitiveActionVerified(
                    userId,
                    "delete-profile",
                    target
                );
                const isVerified = await redis.get(verifiedKey);
                if (isVerified !== "verified") {
                    return status(401, {
                        success: false,
                        error: "Purging profile data requires verification via primary email OTP.",
                    });
                }
                await redis.del(verifiedKey);
            }

            await db.transaction(async (tx) => {
                // Delete all pulls for this specific account
                await tx
                    .delete(pull)
                    .where(
                        and(
                            eq(pull.userId, userId),
                            eq(pull.gameId, gameId),
                            eq(pull.gameUid, gameUid)
                        )
                    );

                // Delete the user_game account record and verify primary status atomically
                const [deletedAccount] = await tx
                    .delete(userGame)
                    .where(eq(userGame.id, existingAccount.id))
                    .returning({ isPrimary: userGame.isPrimary });

                // If the deleted account was primary, promote the earliest remaining account
                if (deletedAccount?.isPrimary) {
                    const nextAccount = await tx.query.userGame.findFirst({
                        where: and(
                            eq(userGame.userId, userId),
                            eq(userGame.gameId, gameId),
                            ne(userGame.id, existingAccount.id)
                        ),
                        columns: { id: true },
                        orderBy: asc(userGame.createdAt),
                    });

                    if (nextAccount) {
                        await tx
                            .update(userGame)
                            .set({ isPrimary: true })
                            .where(eq(userGame.id, nextAccount.id));
                    }
                }
            });

            // Flush Redis caches
            await redis.del(RedisKeys.stats(userId, gameId));
            await redis.del(RedisKeys.stats(userId, gameId, "all"));
            await redis.del(RedisKeys.stats(userId, gameId, gameUid));
            await redis.del(RedisKeys.userGameLatest(userId, gameId, gameUid));
            await redis.del(RedisKeys.userGameLatest(userId, gameId));

            return status(200, { success: true });
        },
        {
            params: t.Object({
                gameId: t.String(),
                gameUid: t.String(),
            }),
            body: t.Optional(
                t.Object({
                    code: t.Optional(t.String()),
                })
            ),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                }),
                400: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                401: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                404: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    );
