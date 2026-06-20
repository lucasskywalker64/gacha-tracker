import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../../lib/redis";
import { getAdapter } from "../games/registry";
import { authPlugin } from "../auth";
import { importPayloadSchema, type NormalizedPull } from "@gacha-tracker/shared";
import { IMPORT_TOKEN_TTL_SECONDS } from "../../config";

export const importRouter = new Elysia({ prefix: "/pulls" })
    .use(authPlugin)
    // 1. Generate an import token for the extraction scripts to use
    .post(
        "/import/token",
        async ({ user, body, status }) => {
            const { gameId } = body;
            const userId = user!.id;
            const token = crypto.randomUUID();
            await redis.set(`import_token:${token}`, userId, "EX", IMPORT_TOKEN_TTL_SECONDS);

            const existingUserGame = await db.query.userGame.findFirst({
                where: and(eq(userGame.userId, user!.id), eq(userGame.gameId, gameId)),
            });

            const latestPullIds = existingUserGame?.latestPullIds
                ? JSON.parse(existingUserGame.latestPullIds)
                : null;

            return status(200, {
                success: true,
                token,
                expiresIn: IMPORT_TOKEN_TTL_SECONDS,
                latestPullIds,
            });
        },
        {
            auth: true,
            body: t.Object({
                gameId: t.String(),
            }),
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    token: t.String(),
                    expiresIn: t.Number(),
                    latestPullIds: t.Optional(
                        t.Union([t.Record(t.String(), t.String()), t.Null()])
                    ),
                }),
            },
        }
    )

    // 2. Start endpoint for the script to notify the UI
    .post(
        "/import/start",
        async ({ request, body, status }) => {
            const authHeader = request.headers.get("authorization");
            if (!authHeader?.startsWith("Bearer ")) {
                return status(401, {
                    success: false,
                    error: "Missing or invalid authorization header",
                });
            }
            const token = authHeader.substring(7);
            const userId = await redis.get(`import_token:${token}`);
            if (!userId) {
                return status(401, { success: false, error: "Invalid or expired import token" });
            }
            const { gameId } = body;
            const channel = `import:${userId}:${gameId}`;
            await redis.publish(channel, JSON.stringify({ type: "started", gameId }));
            return status(200, { success: true });
        },
        {
            body: t.Object({ gameId: t.String() }),
            response: {
                200: t.Object({ success: t.Boolean() }),
                401: t.Object({ success: t.Boolean(), error: t.String() }),
            },
        }
    )

    // 3. Accept the import payload
    .post(
        "/import",
        async ({ request, body, status }) => {
            const authHeader = request.headers.get("authorization");
            if (!authHeader?.startsWith("Bearer ")) {
                return status(401, {
                    success: false,
                    error: "Missing or invalid authorization header",
                });
            }

            const token = authHeader.substring(7);
            const userId = await redis.get(`import_token:${token}`);

            if (!userId) {
                return status(401, { success: false, error: "Invalid or expired import token" });
            }

            // Immediately delete the token to prevent reuse
            await redis.del(`import_token:${token}`);

            const payload = importPayloadSchema.parse(body);
            const adapter = getAdapter(payload.gameId);

            // Normalize pulls
            const normalizedResult = await adapter.normalizeImport(payload);
            const allPulls = normalizedResult.pulls;

            if (allPulls.length === 0) {
                return status(200, { success: true, imported: 0, message: "No pulls to import" });
            }

            let newCount = 0;

            await db.transaction(async (tx) => {
                // Find existing userGame
                let currentUserGame = await tx.query.userGame.findFirst({
                    where: and(eq(userGame.userId, userId), eq(userGame.gameId, payload.gameId)),
                });

                if (!currentUserGame) {
                    const userGameId = crypto.randomUUID();
                    await tx.insert(userGame).values({
                        id: userGameId,
                        userId,
                        gameId: payload.gameId,
                        latestPullIds: "{}",
                    });

                    currentUserGame = {
                        id: userGameId,
                        userId,
                        gameId: payload.gameId,
                        lastImport: null,
                        latestPullIds: "{}",
                        createdAt: new Date(),
                    };
                }

                // We should group pulls by bannerType to calculate pity easily.
                // Or if we want generic pity computed, we can get all existing pulls from the DB,
                // merge them with the new pulls, and recompute pity.
                // For Phase 1, we can just fetch existing pulls for this user/game,
                // compute pity on the combined array, and then upsert everything.

                const existingDbPulls = await tx.query.pull.findMany({
                    where: and(eq(pull.userId, userId), eq(pull.gameId, payload.gameId)),
                    orderBy: (pull, { asc }) => [asc(pull.pulledAt)], // Needs to be sorted properly
                });

                // Convert existing DB pulls to NormalizedPull format
                const existingNormalizedPulls: NormalizedPull[] = existingDbPulls.map((p) => ({
                    pullId: p.pullId,
                    gameUid: p.gameUid,
                    bannerType: p.bannerType,
                    ...(p.bannerId ? { bannerId: p.bannerId } : {}),
                    itemId: p.itemId,
                    itemName: p.itemName,
                    itemType: p.itemType,
                    rarity: p.rarity,
                    pulledAt: new Date(p.pulledAt),
                    pityAtPull: p.pityAtPull,
                    wasGuaranteed: p.wasGuaranteed,
                    extra: p.extra ? JSON.parse(p.extra) : undefined,
                }));

                // Merge existing and new pulls, removing duplicates
                const combinedPullsMap = new Map(existingNormalizedPulls.map((p) => [p.pullId, p]));

                for (const p of allPulls) {
                    if (!combinedPullsMap.has(p.pullId)) {
                        combinedPullsMap.set(p.pullId, p);
                        newCount++;
                    }
                }

                if (newCount === 0) {
                    return;
                }

                // Group by pity pool to compute pity
                const pullsByPool = new Map<string, NormalizedPull[]>();
                for (const pull of Array.from(combinedPullsMap.values())) {
                    const poolKey = adapter.pityPools?.[pull.bannerType] || pull.bannerType;
                    const arr = pullsByPool.get(poolKey) || [];
                    arr.push(pull as NormalizedPull);
                    pullsByPool.set(poolKey, arr);
                }

                // Calculate Pity and collect them to insert/update
                const pullsToUpsert = [];
                const latestIds: Record<string, string> = {};

                for (const [poolKey, pullsInPool] of Array.from(pullsByPool.entries())) {
                    // Sort explicitly by pulledAt then pullId to break ties predictably
                    pullsInPool.sort((a: NormalizedPull, b: NormalizedPull) => {
                        if (a.pulledAt.getTime() === b.pulledAt.getTime()) {
                            return a.pullId.localeCompare(b.pullId);
                        }
                        return a.pulledAt.getTime() - b.pulledAt.getTime();
                    });

                    // Run the game adapter's pity calculation
                    const processedPulls = adapter.computePity(pullsInPool, poolKey);

                    for (const p of processedPulls) {
                        pullsToUpsert.push({
                            id: crypto.randomUUID(), // we will overwrite id if it exists
                            userId,
                            gameId: payload.gameId,
                            gameUid: payload.gameUid,
                            pullId: p.pullId,
                            bannerType: p.bannerType,
                            bannerId: p.bannerId || null,
                            itemId: p.itemId,
                            itemName: p.itemName,
                            itemType: p.itemType,
                            rarity: p.rarity,
                            pulledAt: p.pulledAt,
                            pityAtPull: p.pityAtPull,
                            wasGuaranteed: p.wasGuaranteed,
                            extra: p.extra ? JSON.stringify(p.extra) : null,
                            pityVersion: 1, // hardcoded for phase 1
                        });

                        latestIds[p.bannerType] = p.pullId;
                    }
                }

                // Chunk inserts for SQLite (max variables limits)
                const CHUNK_SIZE = 100;
                for (let i = 0; i < pullsToUpsert.length; i += CHUNK_SIZE) {
                    const chunk = pullsToUpsert.slice(i, i + CHUNK_SIZE);
                    await tx
                        .insert(pull)
                        .values(chunk)
                        .onConflictDoUpdate({
                            target: [pull.userId, pull.gameId, pull.pullId],
                            set: {
                                pityAtPull: sql`excluded.pity_at_pull`,
                                wasGuaranteed: sql`excluded.was_guaranteed`,
                                pityVersion: sql`excluded.pity_version`,
                                bannerId: sql`excluded.banner_id`,
                            },
                        });
                }

                // Update userGame
                await tx
                    .update(userGame)
                    .set({
                        lastImport: new Date(),
                        latestPullIds: JSON.stringify(latestIds),
                    })
                    .where(eq(userGame.id, currentUserGame.id));
            });

            const channel = `import:${userId}:${payload.gameId}`;

            // Invalidate stats cache so the dashboard shows fresh pity immediately
            await redis.del(`stats:${userId}:${payload.gameId}`);

            if (newCount === 0) {
                await redis.publish(
                    channel,
                    JSON.stringify({ type: "complete", imported: 0, gameId: payload.gameId })
                );
                return status(200, { success: true, imported: 0, message: "No new pulls found" });
            }

            await redis.publish(
                channel,
                JSON.stringify({ type: "complete", imported: newCount, gameId: payload.gameId })
            );

            return status(200, {
                success: true,
                imported: newCount,
                message: "Pulls imported successfully",
            });
        },
        {
            body: importPayloadSchema,
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    imported: t.Number(),
                    message: t.String(),
                }),
                401: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    );
