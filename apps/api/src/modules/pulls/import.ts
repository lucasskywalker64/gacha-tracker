import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame } from "../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../../lib/redis";
import { getAdapter } from "../games/registry";
import { authPlugin } from "../auth";
import { z, ZodError } from "zod";
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
            profileUids: entry.profileUids,
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
                    normalizedPulls,
                    gameData.nickname
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
            const { gameId, gameUid } = body;
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

            let latestPullIds: Record<string, string> | null = null;
            if (gameUid) {
                const existingUserGame = await db.query.userGame.findFirst({
                    where: and(
                        eq(userGame.userId, userId),
                        eq(userGame.gameId, gameId),
                        eq(userGame.gameUid, gameUid)
                    ),
                });

                if (existingUserGame?.latestPullIds) {
                    try {
                        latestPullIds = JSON.parse(existingUserGame.latestPullIds);
                    } catch {
                        latestPullIds = null;
                    }
                }
            }

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
                gameUid: t.Optional(t.String()),
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

            const [userPulls, userGames] = await Promise.all([
                db.query.pull.findMany({
                    where: eq(pull.userId, userId),
                    orderBy: (pull, { asc }) => [asc(pull.pulledAt)],
                }),
                db.query.userGame.findMany({
                    where: eq(userGame.userId, userId),
                }),
            ]);

            const gamesMap = new Map<
                string,
                Map<
                    string,
                    {
                        gameUid: string;
                        nickname: string | null;
                        isPrimary: boolean;
                        lastImport: string | null;
                        pulls: ExportPullData[];
                    }
                >
            >();

            for (const ug of userGames) {
                if (!gamesMap.has(ug.gameId)) {
                    gamesMap.set(ug.gameId, new Map());
                }
                gamesMap.get(ug.gameId)!.set(ug.gameUid, {
                    gameUid: ug.gameUid,
                    nickname: ug.nickname ?? null,
                    isPrimary: ug.isPrimary,
                    lastImport: ug.lastImport ? ug.lastImport.toISOString() : null,
                    pulls: [],
                });
            }

            for (const p of userPulls) {
                if (!gamesMap.has(p.gameId)) {
                    gamesMap.set(p.gameId, new Map());
                }
                const accountsMap = gamesMap.get(p.gameId)!;
                if (!accountsMap.has(p.gameUid)) {
                    accountsMap.set(p.gameUid, {
                        gameUid: p.gameUid,
                        nickname: null,
                        isPrimary: false,
                        lastImport: null,
                        pulls: [],
                    });
                }
                accountsMap.get(p.gameUid)!.pulls.push({
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

            const games = Array.from(gamesMap.entries()).map(([gameId, accountsMap]) => ({
                gameId,
                accounts: Array.from(accountsMap.values()),
            }));

            const exportData = {
                version: 1,
                exportedAt: new Date().toISOString(),
                games,
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
                    let profileUidsMap: Record<string, string> | undefined;
                    if (body.profileUids) {
                        let candidate: unknown = body.profileUids;
                        if (typeof body.profileUids === "string") {
                            try {
                                candidate = JSON.parse(body.profileUids);
                            } catch {
                                throw new Error(
                                    "validation: profileUids must be valid JSON mapping profile keys to UIDs."
                                );
                            }
                        }
                        const parsedUids = z.record(z.string(), z.string()).safeParse(candidate);
                        if (!parsedUids.success) {
                            throw new Error(
                                "validation: profileUids must map profile keys to UID strings."
                            );
                        }
                        profileUidsMap = parsedUids.data;
                    }

                    buffer = Buffer.from(await file.arrayBuffer());
                    requestId = crypto.randomUUID();
                    queuedEntry = enqueue({
                        requestId,
                        userId,
                        buffer,
                        format,
                        gameUid: body.gameUid?.trim() || undefined,
                        profileUids: profileUidsMap,
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
                    if (msg.startsWith("validation:")) {
                        message = msg.replace(/^validation:\s*/, "");
                    } else if (msg.includes("Unsupported import format")) {
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
                profileUids: t.Optional(t.Union([t.String(), t.Record(t.String(), t.String())])),
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
                return status(200, {
                    status: "expired",
                    position: null,
                    waitedSeconds: 0,
                    error: "Import request result has expired.",
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
                return status(200, {
                    status: "expired",
                    position: null,
                    waitedSeconds: 0,
                    error: "Import request result has expired.",
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

            const success = await cancel(requestId, userId);
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
    allPulls: NormalizedPull[],
    nickname?: string | null
): Promise<{ imported: number }> {
    if (allPulls.length === 0) {
        return { imported: 0 };
    }

    // Scoped per user and game so that concurrent first imports cannot both claim primary
    const lockKey = `import_lock:${userId}:${gameId}`;
    let lockAcquired = true;
    try {
        const acquired = await redis.set(lockKey, "1", "EX", 60, "NX");
        lockAcquired = acquired === "OK";
    } catch {
        // Fallback silently if Redis is offline
    }

    if (!lockAcquired) {
        throw new Error("CONCURRENT_IMPORT_IN_PROGRESS");
    }

    try {
        const adapter = getAdapter(gameId);

        // 1. Read existing pulls outside transaction lock to reduce SQLite write lock contention
        const existingDbPulls = await db.query.pull.findMany({
            where: and(eq(pull.userId, userId), eq(pull.gameId, gameId), eq(pull.gameUid, gameUid)),
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
            combinedPullsMap.set(p.pullId, p);
        }

        // 2. CPU Pity Calculation performed completely out of transaction lock
        const pullsByPool = new Map<string, NormalizedPull[]>();
        for (const p of Array.from(combinedPullsMap.values())) {
            const poolKey = adapter.pityPools?.[p.bannerType] || p.bannerType;
            if (!pullsByPool.has(poolKey)) {
                pullsByPool.set(poolKey, []);
            }
            pullsByPool.get(poolKey)!.push(p);
        }

        const pullsToUpsert: Array<{
            id: string;
            userId: string;
            gameId: string;
            gameUid: string;
            pullId: string;
            bannerType: string;
            bannerId: string | null;
            itemId: string;
            itemName: string;
            itemType: string;
            rarity: number;
            pulledAt: Date;
            pityAtPull: number;
            wasGuaranteed: number;
            pityVersion: number;
        }> = [];

        const latestIds: Record<string, string> = {};

        const existingByPullId = new Map(existingDbPulls.map((p) => [p.pullId, p]));
        let newPullCount = 0;

        for (const [poolKey, poolPulls] of pullsByPool) {
            poolPulls.sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());
            const computedPulls = adapter.computePity(poolPulls, poolKey);

            for (const p of computedPulls) {
                const existing = existingByPullId.get(p.pullId);
                const pityChanged =
                    existing !== undefined &&
                    (existing.pityAtPull !== p.pityAtPull ||
                        existing.wasGuaranteed !== p.wasGuaranteed);

                if (existing === undefined) newPullCount++;

                if (existing === undefined || pityChanged) {
                    pullsToUpsert.push({
                        id: existing?.id ?? crypto.randomUUID(),
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
                }
                latestIds[p.bannerType] = p.pullId;
            }
        }

        // 3. Strictly write-only database transaction
        await db.transaction(async (tx) => {
            const currentUserGame = await tx.query.userGame.findFirst({
                where: and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.gameUid, gameUid)
                ),
            });

            let userGameId: string;
            if (!currentUserGame) {
                // Check if this is the first account for this user & game
                const anyExistingGame = await tx.query.userGame.findFirst({
                    where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
                });
                const isPrimary = !anyExistingGame;

                userGameId = crypto.randomUUID();
                await tx.insert(userGame).values({
                    id: userGameId,
                    userId,
                    gameId,
                    gameUid,
                    nickname: nickname || null,
                    isPrimary,
                    latestPullIds: "{}",
                });
            } else {
                userGameId = currentUserGame.id;
                if (!currentUserGame.nickname && nickname) {
                    await tx.update(userGame).set({ nickname }).where(eq(userGame.id, userGameId));
                }
            }

            // Dynamically calculate insertion batch chunk size based on SQLite max variable limit
            const COLUMNS_PER_ROW = 15;
            const SQLITE_MAX_VARIABLE_NUMBER = 32766;
            const CHUNK_SIZE = Math.min(
                500,
                Math.floor(SQLITE_MAX_VARIABLE_NUMBER / COLUMNS_PER_ROW)
            );

            for (let i = 0; i < pullsToUpsert.length; i += CHUNK_SIZE) {
                const chunk = pullsToUpsert.slice(i, i + CHUNK_SIZE);
                await tx
                    .insert(pull)
                    .values(chunk)
                    .onConflictDoUpdate({
                        target: [pull.userId, pull.gameId, pull.gameUid, pull.pullId],
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
                .where(eq(userGame.id, userGameId));
        });

        try {
            await Promise.all([
                redis.del(RedisKeys.stats(userId, gameId, gameUid)),
                redis.del(RedisKeys.stats(userId, gameId, "all")),
                redis.del(RedisKeys.stats(userId, gameId)),
            ]);
        } catch {
            // Stats cache invalidation is best-effort; the import already committed
        }

        return { imported: newPullCount };
    } finally {
        if (lockAcquired) {
            try {
                await redis.del(lockKey);
            } catch {
                // Fallback silently if Redis is offline
            }
        }
    }
}
