import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../../lib/redis";
import { getAdapter } from "../games/registry";
import { authPlugin } from "../auth";
import { ZodError } from "zod";
import {
    importPayloadSchema,
    type NormalizedPull,
    type ExportPullData,
} from "@gacha-tracker/shared";
import { IMPORT_TOKEN_TTL_SECONDS, IMPORT_USER_COOLDOWN_SECONDS } from "../../config";
import { getParser, getSupportedFormats } from "./parsers/registry";
import type { ParseContext } from "./parsers/types";
import { RedisKeys } from "../../lib/redis-keys";
import {
    enqueue,
    getStatus,
    cancel,
    getRequestOwner,
    registerWorker,
    ImportStatus,
    type ImportSummaryItem,
} from "../../lib/importQueue";

registerWorker(async (entry) => {
    try {
        const parser = getParser(entry.format);
        const context: ParseContext = {
            gameUid: entry.gameUid?.trim() || undefined,
        };
        const parsed = await parser.parse(entry.buffer, context);

        const summary: ImportSummaryItem[] = [];

        for (const gameData of parsed.games) {
            try {
                const normalizedPulls: NormalizedPull[] = gameData.pulls.map((p) => ({
                    pullId: p.pullId,
                    gameUid: gameData.gameUid,
                    bannerType: p.bannerType,
                    bannerId: p.bannerId || undefined,
                    itemId: p.itemId,
                    itemName: p.itemName,
                    itemType: p.itemType,
                    rarity: p.rarity,
                    pulledAt: p.pulledAt,
                    pityAtPull: 0,
                    wasGuaranteed: 0,
                }));

                const { imported } = await executePullsImport(
                    entry.userId,
                    gameData.gameId,
                    gameData.gameUid,
                    normalizedPulls
                );

                summary.push({
                    gameId: gameData.gameId,
                    gameUid: gameData.gameUid,
                    imported,
                    message: `Imported ${imported} new pulls.`,
                    success: true,
                });
            } catch (gameErr) {
                console.error(
                    `[file-import-worker] Failed to import game ${gameData.gameId}:`,
                    gameErr
                );

                let errMsg = "An unexpected error occurred while saving data.";
                if (gameErr instanceof Error) {
                    const msg = gameErr.message;
                    // Safe to expose game/adapter validation failures
                    if (
                        msg.includes("Game adapter not found") ||
                        msg.includes("Unsupported game")
                    ) {
                        errMsg = msg;
                    } else if (msg.includes("Invalid time value") || msg.includes("invalid date")) {
                        errMsg = "Invalid pull date format detected in backup.";
                    }
                }

                summary.push({
                    gameId: gameData.gameId,
                    gameUid: gameData.gameUid,
                    imported: 0,
                    message: errMsg,
                    success: false,
                });
            }
        }
        return summary;
    } catch (err) {
        if (err instanceof ZodError) {
            const issueMessages = err.issues.map((issue) => {
                const path = issue.path.join(".");
                return `${path ? `[${path}] ` : ""}${issue.message}`;
            });
            throw new Error(`Invalid backup data structure: ${issueMessages.join("; ")}`, {
                cause: err,
            });
        }
        if (err instanceof SyntaxError) {
            throw new Error(
                "Invalid JSON structure. Please ensure the file is a valid JSON backup.",
                { cause: err }
            );
        }
        throw err;
    }
});

export const importRouter = new Elysia({ prefix: "/pulls" })
    .use(authPlugin)
    // 1. Generate an import token for the extraction scripts to use
    .post(
        "/import/token",
        async ({ user, body, status }) => {
            const { gameId } = body;
            const userId = user!.id;

            const cooldownKey = RedisKeys.importCooldown(userId);
            const ttl = await redis.ttl(cooldownKey);
            if (ttl > 0) {
                return status(429, {
                    success: false,
                    error: `You can only import once per minute. Please wait ${ttl} second(s).`,
                    retryAfter: ttl,
                });
            }

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
                429: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                    retryAfter: t.Number(),
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

            const cooldownKey = RedisKeys.importCooldown(userId);
            const ttl = await redis.ttl(cooldownKey);
            if (ttl > 0) {
                return status(429, {
                    success: false,
                    error: `You can only import once per minute. Please wait ${ttl} second(s).`,
                    retryAfter: ttl,
                });
            }

            // Immediately delete the token to prevent reuse
            await redis.del(`import_token:${token}`);

            // Acquire cooldown lock
            await redis.set(cooldownKey, "1", "EX", IMPORT_USER_COOLDOWN_SECONDS);

            const payload = importPayloadSchema.parse(body);
            const adapter = getAdapter(payload.gameId);

            // Normalize pulls
            const normalizedResult = await adapter.normalizeImport(payload);
            const allPulls = normalizedResult.pulls;

            if (allPulls.length === 0) {
                return status(200, { success: true, imported: 0, message: "No pulls to import" });
            }

            const { imported } = await executePullsImport(
                userId,
                payload.gameId,
                payload.gameUid,
                allPulls
            );

            const channel = `import:${userId}:${payload.gameId}`;

            if (imported === 0) {
                await redis.publish(
                    channel,
                    JSON.stringify({ type: "complete", imported: 0, gameId: payload.gameId })
                );
                return status(200, { success: true, imported: 0, message: "No new pulls found" });
            }

            await redis.publish(
                channel,
                JSON.stringify({ type: "complete", imported, gameId: payload.gameId })
            );

            return status(200, {
                success: true,
                imported,
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
                429: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                    retryAfter: t.Number(),
                }),
            },
        }
    )

    // 4. Export all user data as native JSON
    .get(
        "/export",
        async ({ user, set }) => {
            const userId = user!.id;

            const userPulls = await db.query.pull.findMany({
                where: eq(pull.userId, userId),
                orderBy: (pull, { asc }) => [asc(pull.pulledAt)],
            });

            const gamesMap = new Map<
                string,
                { gameId: string; gameUid: string; pulls: ExportPullData[] }
            >();

            for (const p of userPulls) {
                const key = `${p.gameId}:${p.gameUid}`;
                if (!gamesMap.has(key)) {
                    gamesMap.set(key, {
                        gameId: p.gameId,
                        gameUid: p.gameUid,
                        pulls: [],
                    });
                }
                gamesMap.get(key)!.pulls.push({
                    pullId: p.pullId,
                    bannerType: p.bannerType,
                    bannerId: p.bannerId,
                    itemId: p.itemId,
                    itemName: p.itemName,
                    itemType: p.itemType,
                    rarity: p.rarity,
                    pulledAt: p.pulledAt.toISOString(),
                    pityAtPull: p.pityAtPull,
                    wasGuaranteed: p.wasGuaranteed,
                });
            }

            const exportData = {
                version: 1,
                exportedAt: new Date().toISOString(),
                games: Array.from(gamesMap.values()),
            };

            set.headers["content-type"] = "application/json";
            set.headers["content-disposition"] =
                `attachment; filename="gacha-tracker-export-${Date.now()}.json"`;

            return JSON.stringify(exportData, null, 2);
        },
        {
            auth: true,
        }
    )

    // 5. Import from uploaded file
    .post(
        "/import/file",
        async ({ user, body, status }) => {
            const userId = user!.id;
            const { file, format } = body;

            try {
                // Validate format synchronously first
                getParser(format);

                const cooldownKey = RedisKeys.importCooldown(userId);

                // Atomically check and acquire the cooldown lock using NX flag
                const isAcquired = await redis.set(
                    cooldownKey,
                    "1",
                    "EX",
                    IMPORT_USER_COOLDOWN_SECONDS,
                    "NX"
                );
                if (!isAcquired) {
                    const ttl = await redis.ttl(cooldownKey);
                    const retryAfter = ttl > 0 ? ttl : IMPORT_USER_COOLDOWN_SECONDS;
                    return status(429, {
                        success: false,
                        error: `You can only import once per minute. Please wait ${retryAfter} second(s).`,
                        retryAfter,
                    });
                }

                let buffer: Buffer;
                let requestId: string;
                let queuedEntry;

                try {
                    buffer = Buffer.from(await file.arrayBuffer());
                    requestId = crypto.randomUUID();
                    queuedEntry = enqueue({
                        requestId,
                        userId,
                        buffer,
                        format,
                        gameUid: body.gameUid?.trim() || undefined,
                    });
                } catch (err) {
                    // Release the cooldown lock if the request failed to parse or enqueue
                    await redis.del(cooldownKey);

                    if (err instanceof Error && err.message === "QUEUE_FULL") {
                        return status(503, {
                            success: false,
                            error: "The import queue is currently full. Please try again later.",
                        });
                    }
                    throw err;
                }

                const cooldownExpiresAt = new Date(
                    Date.now() + IMPORT_USER_COOLDOWN_SECONDS * 1000
                ).toISOString();

                const qStatus = await getStatus(requestId);
                const position = qStatus?.position ?? 1;

                return status(202, {
                    requestId,
                    position,
                    queuedAt: queuedEntry.queuedAt.toISOString(),
                    cooldownExpiresAt,
                });
            } catch (err) {
                console.error("[file-import] Failed to initialize import:", err);
                let message = "Failed to process import file.";
                if (err instanceof ZodError) {
                    const issueMessages = err.issues.map((issue) => {
                        const path = issue.path.join(".");
                        return `${path ? `[${path}] ` : ""}${issue.message}`;
                    });
                    message = `Invalid backup data structure: ${issueMessages.join("; ")}`;
                } else if (err instanceof Error) {
                    const msg = err.message;
                    if (msg.includes("Unsupported import format") || msg.includes("validation")) {
                        message = msg;
                    } else if (err instanceof SyntaxError) {
                        message =
                            "Invalid JSON structure. Please ensure the file is a valid JSON backup.";
                    }
                }
                return status(422, {
                    success: false,
                    error: message,
                });
            }
        },
        {
            auth: true,
            body: t.Object({
                file: t.File({
                    maxSize: 5 * 1024 * 1024,
                }),
                format: t.String(),
                gameUid: t.Optional(t.String()),
            }),

            response: {
                202: t.Object({
                    requestId: t.String(),
                    position: t.Number(),
                    queuedAt: t.String(),
                    cooldownExpiresAt: t.String(),
                }),
                422: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                429: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                    retryAfter: t.Number(),
                }),
                503: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    )

    // 5a. Get import status
    .get(
        "/import/status/:requestId",
        async ({ user, params, status }) => {
            const userId = user!.id;
            const { requestId } = params;

            const ownerId = await getRequestOwner(requestId);
            if (!ownerId) {
                return status(404, {
                    success: false,
                    error: "Import request not found or expired.",
                });
            }

            if (ownerId !== userId) {
                return status(403, {
                    success: false,
                    error: "Access denied.",
                });
            }

            const qStatus = await getStatus(requestId);
            if (!qStatus) {
                return status(404, {
                    success: false,
                    error: "Import request not found or expired.",
                });
            }

            return {
                status: qStatus.status,
                position: qStatus.position,
                waitedSeconds: qStatus.waitedSeconds,
                result: qStatus.result
                    ? { success: qStatus.result.some((s) => s.success), summary: qStatus.result }
                    : undefined,
                error: qStatus.error,
            };
        },
        {
            auth: true,
            response: {
                200: t.Object({
                    status: t.String(),
                    position: t.Union([t.Number(), t.Null()]),
                    waitedSeconds: t.Number(),
                    result: t.Optional(
                        t.Object({
                            success: t.Boolean(),
                            summary: t.Array(
                                t.Object({
                                    gameId: t.String(),
                                    gameUid: t.String(),
                                    imported: t.Number(),
                                    message: t.String(),
                                    success: t.Boolean(),
                                })
                            ),
                        })
                    ),
                    error: t.Optional(t.String()),
                }),
                403: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                404: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    )

    // 5b. Cancel queued import
    .delete(
        "/import/queue/:requestId",
        async ({ user, params, status }) => {
            const userId = user!.id;
            const { requestId } = params;

            const ownerId = await getRequestOwner(requestId);
            if (!ownerId) {
                return status(404, {
                    success: false,
                    error: "Import request not found or expired.",
                });
            }

            if (ownerId !== userId) {
                return status(403, {
                    success: false,
                    error: "Access denied.",
                });
            }

            const qStatus = await getStatus(requestId);
            if (!qStatus) {
                return status(404, {
                    success: false,
                    error: "Import request not found or expired.",
                });
            }

            if (qStatus.status !== ImportStatus.QUEUED) {
                return status(409, {
                    success: false,
                    error: "Import is already processing and cannot be cancelled.",
                });
            }

            const success = cancel(requestId, userId);
            if (!success) {
                return status(409, {
                    success: false,
                    error: "Import is already processing and cannot be cancelled.",
                });
            }

            return { success: true };
        },
        {
            auth: true,
            response: {
                200: t.Object({
                    success: t.Boolean(),
                }),
                403: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                404: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
                409: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
                }),
            },
        }
    )

    // 6. Get list of supported import formats
    .get(
        "/import/formats",
        async () => {
            return {
                formats: getSupportedFormats(),
            };
        },
        {
            auth: true,
            response: {
                200: t.Object({
                    formats: t.Array(
                        t.Object({
                            id: t.String(),
                            displayName: t.String(),
                            acceptedExtensions: t.String(),
                        })
                    ),
                }),
            },
        }
    );

export async function executePullsImport(
    userId: string,
    gameId: string,
    gameUid: string,
    allPulls: NormalizedPull[]
): Promise<{ imported: number }> {
    if (allPulls.length === 0) {
        return { imported: 0 };
    }

    const adapter = getAdapter(gameId);
    let newCount = 0;

    await db.transaction(async (tx) => {
        let currentUserGame = await tx.query.userGame.findFirst({
            where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
        });

        if (!currentUserGame) {
            const userGameId = crypto.randomUUID();
            await tx.insert(userGame).values({
                id: userGameId,
                userId,
                gameId,
                latestPullIds: "{}",
            });

            currentUserGame = {
                id: userGameId,
                userId,
                gameId,
                lastImport: null,
                latestPullIds: "{}",
                createdAt: new Date(),
            };
        }

        const existingDbPulls = await tx.query.pull.findMany({
            where: and(eq(pull.userId, userId), eq(pull.gameId, gameId)),
            orderBy: (pull, { asc }) => [asc(pull.pulledAt)],
        });

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
        }));

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

        const pullsByPool = new Map<string, NormalizedPull[]>();
        for (const p of Array.from(combinedPullsMap.values())) {
            const poolKey = adapter.pityPools?.[p.bannerType] || p.bannerType;
            const arr = pullsByPool.get(poolKey) || [];
            arr.push(p as NormalizedPull);
            pullsByPool.set(poolKey, arr);
        }

        const pullsToUpsert = [];
        const latestIds: Record<string, string> = {};

        for (const [poolKey, pullsInPool] of Array.from(pullsByPool.entries())) {
            pullsInPool.sort((a: NormalizedPull, b: NormalizedPull) => {
                if (a.pulledAt.getTime() === b.pulledAt.getTime()) {
                    return a.pullId.localeCompare(b.pullId);
                }
                return a.pulledAt.getTime() - b.pulledAt.getTime();
            });

            const processedPulls = adapter.computePity(pullsInPool, poolKey);

            for (const p of processedPulls) {
                pullsToUpsert.push({
                    id: crypto.randomUUID(),
                    userId,
                    gameId,
                    gameUid,
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
                    pityVersion: 1,
                });

                latestIds[p.bannerType] = p.pullId;
            }
        }

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

        await tx
            .update(userGame)
            .set({
                lastImport: new Date(),
                latestPullIds: JSON.stringify(latestIds),
            })
            .where(eq(userGame.id, currentUserGame.id));
    });

    await redis.del(`stats:${userId}:${gameId}`);

    return { imported: newCount };
}
