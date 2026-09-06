import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { pull, userGame, type FiveStarHistoryItem } from "../../db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
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
import {
    createPendingImportLog,
    updateSuccessImportLog,
    updateFailedImportLog,
    deletePendingLog,
} from "./importLog.helper";

registerWorker(async (entry) => {
    const tWorkerStart = performance.now();
    let rootLogFinalized = false;
    const queueWaitDurationMs = entry.startedProcessingAt
        ? Math.max(0, Math.round(entry.startedProcessingAt.getTime() - entry.queuedAt.getTime()))
        : 0;

    try {
        const parser = getParser(entry.format);
        const context: ParseContext = {
            gameUid: entry.gameUid?.trim() || undefined,
            profileUids: entry.profileUids,
        };
        const parsed = await parser.parse(entry.buffer, context);

        const summary: ImportSummaryItem[] = [];

        if (parsed.games.length === 0) {
            await updateSuccessImportLog(entry.requestId, {
                userId: entry.userId,
                importMethod: `file_${entry.format}`,
                sourceIp: entry.sourceIp,
                userAgent: entry.userAgent,
                payloadSizeBytes: entry.payloadSizeBytes,
                totalFetched: 0,
                newPulls: 0,
                duplicates: 0,
                backendDurationMs: Math.round(performance.now() - tWorkerStart),
                queueWaitDurationMs,
                totalDurationMs: Date.now() - entry.queuedAt.getTime(),
                bannersAffectedCount: 0,
            });
            rootLogFinalized = true;
        }

        for (let i = 0; i < parsed.games.length; i++) {
            const gameData = parsed.games[i];
            const importLogId =
                i === 0
                    ? entry.requestId
                    : await createPendingImportLog({
                          userId: entry.userId,
                          gameId: gameData.gameId,
                          gameUid: gameData.gameUid,
                          importMethod: `file_${entry.format}`,
                          sourceIp: entry.sourceIp,
                          userAgent: entry.userAgent,
                          scriptVersion: entry.scriptVersion,
                          webAppVersion: entry.webAppVersion,
                          fileVersion: parsed.fileVersion,
                          payloadSizeBytes: entry.payloadSizeBytes,
                          queueWaitDurationMs,
                          initiatedAt: entry.queuedAt,
                      });

            try {
                const tGameStart = performance.now();
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

                const result = await executePullsImport(
                    entry.userId,
                    gameData.gameId,
                    gameData.gameUid,
                    normalizedPulls,
                    gameData.nickname
                );

                await updateSuccessImportLog(importLogId, {
                    userId: entry.userId,
                    importMethod: `file_${entry.format}`,
                    sourceIp: entry.sourceIp,
                    userAgent: entry.userAgent,
                    payloadSizeBytes: entry.payloadSizeBytes,
                    gameId: gameData.gameId,
                    gameUid: gameData.gameUid,
                    totalFetched: result.totalFetched,
                    newPulls: result.imported,
                    duplicates: result.duplicates,
                    pityCalcDurationMs: result.pityCalcDurationMs,
                    dbWriteDurationMs: result.dbWriteDurationMs,
                    queueWaitDurationMs,
                    earliestPullAt: result.earliestPullAt,
                    latestPullAt: result.latestPullAt,
                    bannersAffectedCount: result.bannersAffectedCount,
                    scriptVersion: entry.scriptVersion,
                    webAppVersion: entry.webAppVersion,
                    fileVersion: parsed.fileVersion,
                    initiatedAt: entry.queuedAt,
                    tBackendStart: tGameStart,
                });
                if (i === 0) {
                    rootLogFinalized = true;
                }

                summary.push({
                    gameId: gameData.gameId,
                    gameUid: gameData.gameUid,
                    imported: result.imported,
                    message: `Imported ${result.imported} new pulls.`,
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

                await updateFailedImportLog(importLogId, {
                    userId: entry.userId,
                    importMethod: `file_${entry.format}`,
                    sourceIp: entry.sourceIp,
                    userAgent: entry.userAgent,
                    payloadSizeBytes: entry.payloadSizeBytes,
                    errorMessage: errMsg,
                    errorCode: "GAME_IMPORT_FAILED",
                    rawErrorStack: gameErr instanceof Error ? gameErr.stack : undefined,
                    backendDurationMs: Math.round(performance.now() - tWorkerStart),
                    queueWaitDurationMs,
                    totalDurationMs: Date.now() - entry.queuedAt.getTime(),
                });
                if (i === 0) {
                    rootLogFinalized = true;
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
        let errorCode = "IMPORT_FAILED";
        let formattedMessage = err instanceof Error ? err.message : String(err);

        if (err instanceof ZodError) {
            errorCode = "SCHEMA_VALIDATION_ERROR";
            const issueMessages = err.issues.map((issue) => {
                const path = issue.path.join(".");
                return `${path ? `[${path}] ` : ""}${issue.message}`;
            });
            formattedMessage = `Invalid backup data structure: ${issueMessages.join("; ")}`;
        } else if (err instanceof SyntaxError) {
            errorCode = "PARSER_INVALID_JSON";
            formattedMessage =
                "Invalid JSON structure. Please ensure the file is a valid JSON backup.";
        }

        const failLogId = rootLogFinalized
            ? await createPendingImportLog({
                  userId: entry.userId,
                  importMethod: `file_${entry.format}`,
                  sourceIp: entry.sourceIp,
                  userAgent: entry.userAgent,
                  scriptVersion: entry.scriptVersion,
                  webAppVersion: entry.webAppVersion,
                  fileVersion: entry.fileVersion,
                  payloadSizeBytes: entry.payloadSizeBytes,
                  queueWaitDurationMs,
                  initiatedAt: entry.queuedAt,
              })
            : entry.requestId;

        await updateFailedImportLog(failLogId, {
            userId: entry.userId,
            importMethod: `file_${entry.format}`,
            sourceIp: entry.sourceIp,
            userAgent: entry.userAgent,
            payloadSizeBytes: entry.payloadSizeBytes,
            errorMessage: formattedMessage,
            errorCode,
            rawErrorStack: err instanceof Error ? err.stack : undefined,
            backendDurationMs: Math.round(performance.now() - tWorkerStart),
            queueWaitDurationMs,
            totalDurationMs: Date.now() - entry.queuedAt.getTime(),
        });

        if (err instanceof ZodError || err instanceof SyntaxError) {
            throw new Error(formattedMessage, { cause: err });
        }
        throw err;
    }
});

function safeString(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === "number" && !isNaN(value)) {
        return String(value);
    }
    return undefined;
}

function extractClientMetadata(request: Request, body?: unknown) {
    const getHeader = (headerName: string): string | undefined => {
        try {
            return safeString(request.headers.get(headerName));
        } catch {
            return undefined;
        }
    };

    const sourceIp =
        getHeader("cf-connecting-ip") ||
        getHeader("x-real-ip") ||
        getHeader("x-forwarded-for")?.split(",")[0]?.trim() ||
        getHeader("x-client-ip");

    const userAgent = getHeader("user-agent");

    let scriptVersion = getHeader("x-script-version");
    let webAppVersion = getHeader("x-web-app-version") || getHeader("x-app-version");

    if (body !== null && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (!scriptVersion) {
            scriptVersion = safeString(b.scriptVersion) || safeString(b.script_version);
        }
        if (!webAppVersion) {
            webAppVersion =
                safeString(b.webAppVersion) ||
                safeString(b.web_app_version) ||
                safeString(b.appVersion) ||
                safeString(b.app_version);
        }
    }

    return { sourceIp, userAgent, scriptVersion, webAppVersion };
}

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
                const cacheKey = RedisKeys.userGameLatest(userId, gameId, gameUid);
                const cached = await redis.get(cacheKey);
                if (cached) {
                    try {
                        latestPullIds = JSON.parse(cached);
                    } catch {
                        latestPullIds = null;
                    }
                } else {
                    const [existingUserGame] = await db
                        .select({ latestPullIds: userGame.latestPullIds })
                        .from(userGame)
                        .where(
                            and(
                                eq(userGame.userId, userId),
                                eq(userGame.gameId, gameId),
                                eq(userGame.gameUid, gameUid)
                            )
                        )
                        .limit(1);

                    if (existingUserGame?.latestPullIds) {
                        try {
                            latestPullIds = JSON.parse(existingUserGame.latestPullIds);
                            await redis.set(
                                cacheKey,
                                existingUserGame.latestPullIds,
                                "EX",
                                86400 * 7
                            );
                        } catch {
                            latestPullIds = null;
                        }
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
            await redis.set(`import_start:${userId}:${gameId}`, Date.now().toString(), "EX", 300);
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
            const tBackendStart = performance.now();

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

            const { sourceIp, userAgent, scriptVersion, webAppVersion } = extractClientMetadata(
                request,
                body
            );
            const contentLength = Number(request.headers.get("content-length"));
            const payloadSizeBytes =
                Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;

            let payload;
            try {
                payload = importPayloadSchema.parse(body);
            } catch (err) {
                await redis.del(cooldownKey);

                if (body !== null && typeof body === "object" && "gameId" in body) {
                    const rawGameId = (body as Record<string, unknown>).gameId;
                    if (typeof rawGameId === "string") {
                        try {
                            await redis.del(`import_start:${userId}:${rawGameId}`);
                        } catch {
                            // Redis cleanup is best-effort
                        }
                    }
                }

                const importLogId = await createPendingImportLog({
                    userId,
                    importMethod: "script_api",
                    sourceIp,
                    userAgent,
                    scriptVersion,
                    webAppVersion,
                    payloadSizeBytes,
                });

                let formattedMessage = err instanceof Error ? err.message : String(err);
                if (err instanceof ZodError) {
                    const issueMessages = err.issues.map((issue) => {
                        const path = issue.path.join(".");
                        return `${path ? `[${path}] ` : ""}${issue.message}`;
                    });
                    formattedMessage = `Invalid import payload: ${issueMessages.join("; ")}`;
                }

                await updateFailedImportLog(importLogId, {
                    userId,
                    importMethod: "script_api",
                    sourceIp,
                    userAgent,
                    payloadSizeBytes,
                    errorMessage: formattedMessage,
                    errorCode: "SCHEMA_VALIDATION_ERROR",
                    rawErrorStack: err instanceof Error ? err.stack : undefined,
                    backendDurationMs: Math.round(performance.now() - tBackendStart),
                    scriptVersion,
                    webAppVersion,
                });

                return status(400, {
                    success: false,
                    error: formattedMessage,
                });
            }

            const startKey = `import_start:${userId}:${payload.gameId}`;
            const scriptStartStr = await redis.get(startKey);
            let scriptDurationMs: number | undefined;
            let initiatedAt = new Date();

            if (scriptStartStr) {
                const scriptStartMs = parseInt(scriptStartStr, 10);
                initiatedAt = new Date(scriptStartMs);
                scriptDurationMs = Math.max(0, Date.now() - scriptStartMs);
                await redis.del(startKey);
            }

            const importLogId = await createPendingImportLog({
                userId,
                gameId: payload.gameId,
                gameUid: payload.gameUid,
                importMethod: "script_api",
                sourceIp,
                userAgent,
                scriptVersion,
                webAppVersion,
                payloadSizeBytes,
                scriptDurationMs,
                initiatedAt,
            });

            try {
                const adapter = getAdapter(payload.gameId);

                // Normalize pulls
                const normalizedResult = await adapter.normalizeImport(payload);
                const allPulls = normalizedResult.pulls;

                const result = await executePullsImport(
                    userId,
                    payload.gameId,
                    payload.gameUid,
                    allPulls
                );

                await updateSuccessImportLog(importLogId, {
                    userId,
                    importMethod: "script_api",
                    sourceIp,
                    userAgent,
                    payloadSizeBytes,
                    gameId: payload.gameId,
                    gameUid: payload.gameUid,
                    totalFetched: result.totalFetched,
                    newPulls: result.imported,
                    duplicates: result.duplicates,
                    pityCalcDurationMs: result.pityCalcDurationMs,
                    dbWriteDurationMs: result.dbWriteDurationMs,
                    earliestPullAt: result.earliestPullAt,
                    latestPullAt: result.latestPullAt,
                    bannersAffectedCount: result.bannersAffectedCount,
                    scriptDurationMs,
                    scriptVersion,
                    webAppVersion,
                    initiatedAt,
                    tBackendStart,
                });

                const channel = `import:${userId}:${payload.gameId}`;

                if (result.imported === 0) {
                    await redis.publish(
                        channel,
                        JSON.stringify({ type: "complete", imported: 0, gameId: payload.gameId })
                    );
                    return status(200, {
                        success: true,
                        imported: 0,
                        message: "No new pulls found",
                    });
                }

                await redis.publish(
                    channel,
                    JSON.stringify({
                        type: "complete",
                        imported: result.imported,
                        gameId: payload.gameId,
                    })
                );

                return status(200, {
                    success: true,
                    imported: result.imported,
                    message: "Pulls imported successfully",
                });
            } catch (err) {
                await updateFailedImportLog(importLogId, {
                    userId,
                    importMethod: "script_api",
                    sourceIp,
                    userAgent,
                    payloadSizeBytes,
                    errorMessage: err instanceof Error ? err.message : String(err),
                    errorCode:
                        err instanceof Error && err.message === "CONCURRENT_IMPORT_IN_PROGRESS"
                            ? "CONCURRENT_IMPORT_LOCKED"
                            : "IMPORT_FAILED",
                    rawErrorStack: err instanceof Error ? err.stack : undefined,
                    initiatedAt,
                    tBackendStart,
                });

                throw err;
            }
        },
        {
            response: {
                200: t.Object({
                    success: t.Boolean(),
                    imported: t.Number(),
                    message: t.String(),
                }),
                400: t.Object({
                    success: t.Boolean(),
                    error: t.String(),
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
        async ({ request, user, body, status }) => {
            const userId = user!.id;
            const { file, format } = body;
            const { sourceIp, userAgent, scriptVersion, webAppVersion } = extractClientMetadata(
                request,
                body
            );

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
                let requestId: string | undefined;
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
                    const initiatedAt = new Date();

                    await createPendingImportLog({
                        id: requestId,
                        userId,
                        gameUid: body.gameUid?.trim() || undefined,
                        importMethod: `file_${format}`,
                        sourceIp,
                        userAgent,
                        scriptVersion,
                        webAppVersion,
                        payloadSizeBytes: buffer.length,
                        initiatedAt,
                    });

                    queuedEntry = enqueue({
                        requestId,
                        userId,
                        buffer,
                        format,
                        gameUid: body.gameUid?.trim() || undefined,
                        profileUids: profileUidsMap,
                        sourceIp,
                        userAgent,
                        scriptVersion,
                        webAppVersion,
                        payloadSizeBytes: buffer.length,
                    });
                } catch (err) {
                    // Release the cooldown lock if the request failed to parse or enqueue
                    await redis.del(cooldownKey);
                    if (requestId) {
                        await deletePendingLog(requestId);
                    }

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
                let errorCode = "FILE_IMPORT_INIT_FAILED";
                if (err instanceof ZodError) {
                    errorCode = "SCHEMA_VALIDATION_ERROR";
                    const issueMessages = err.issues.map((issue) => {
                        const path = issue.path.join(".");
                        return `${path ? `[${path}] ` : ""}${issue.message}`;
                    });
                    message = `Invalid backup data structure: ${issueMessages.join("; ")}`;
                } else if (err instanceof SyntaxError) {
                    errorCode = "PARSER_INVALID_JSON";
                    message =
                        "Invalid JSON structure. Please ensure the file is a valid JSON backup.";
                } else if (err instanceof Error) {
                    const msg = err.message;
                    if (msg.startsWith("validation:")) {
                        errorCode = "SCHEMA_VALIDATION_ERROR";
                        message = msg.replace(/^validation:\s*/, "");
                    } else if (msg.includes("Unsupported import format")) {
                        errorCode = "UNSUPPORTED_FORMAT";
                        message = msg;
                    } else if (msg.includes("validation")) {
                        errorCode = "SCHEMA_VALIDATION_ERROR";
                        message = msg;
                    } else {
                        message = msg;
                    }
                }

                const errId = crypto.randomUUID();
                await createPendingImportLog({
                    id: errId,
                    userId,
                    importMethod: `file_${format}`,
                    sourceIp,
                    userAgent,
                    scriptVersion,
                    webAppVersion,
                });
                await updateFailedImportLog(errId, {
                    errorMessage: message,
                    errorCode,
                    rawErrorStack: err instanceof Error ? err.stack : undefined,
                    scriptVersion,
                    webAppVersion,
                });

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

export interface ExecutePullsImportResult {
    imported: number;
    totalFetched: number;
    duplicates: number;
    pityCalcDurationMs: number;
    dbWriteDurationMs: number;
    earliestPullAt?: Date;
    latestPullAt?: Date;
    bannersAffectedCount: number;
}

export async function executePullsImport(
    userId: string,
    gameId: string,
    gameUid: string,
    allPulls: NormalizedPull[],
    nickname?: string | null
): Promise<ExecutePullsImportResult> {
    if (allPulls.length === 0) {
        return {
            imported: 0,
            totalFetched: 0,
            duplicates: 0,
            pityCalcDurationMs: 0,
            dbWriteDurationMs: 0,
            bannersAffectedCount: 0,
        };
    }

    let earliestPullAt: Date | undefined;
    let latestPullAt: Date | undefined;
    for (const p of allPulls) {
        if (!earliestPullAt || p.pulledAt < earliestPullAt) {
            earliestPullAt = p.pulledAt;
        }
        if (!latestPullAt || p.pulledAt > latestPullAt) {
            latestPullAt = p.pulledAt;
        }
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

        // 1. Read existing userGame record and determine if incremental active window can be used
        const [existingUserGame] = await db
            .select()
            .from(userGame)
            .where(
                and(
                    eq(userGame.userId, userId),
                    eq(userGame.gameId, gameId),
                    eq(userGame.gameUid, gameUid)
                )
            )
            .limit(1);

        let canUseIncrementalWindow = false;
        let minCutoffTime: number | null = null;
        let parsedFiveStarHistory: FiveStarHistoryItem[] = [];

        if (
            existingUserGame?.statsFiveStarHistory &&
            existingUserGame.statsFiveStarHistory.length > 0
        ) {
            parsedFiveStarHistory = existingUserGame.statsFiveStarHistory;
            const currentPity = existingUserGame.statsCurrentPity ?? {};

            // Determine latest 5-star timestamp per pool
            const poolLatestFiveStarTime = new Map<string, number>();
            for (const h of parsedFiveStarHistory) {
                const poolKey = adapter.pityPools?.[h.bannerType] || h.bannerType;
                const current = poolLatestFiveStarTime.get(poolKey) || 0;
                if (h.pulledAt > current) {
                    poolLatestFiveStarTime.set(poolKey, h.pulledAt);
                }
            }

            // Check that all pools with active pity (> 0) have a known 5-star cutoff
            let allActivePoolsHaveCutoff = true;
            for (const [bannerOrPool, pityCount] of Object.entries(currentPity)) {
                if (pityCount > 0) {
                    const poolKey = adapter.pityPools?.[bannerOrPool] || bannerOrPool;
                    if (!poolLatestFiveStarTime.has(poolKey)) {
                        allActivePoolsHaveCutoff = false;
                        break;
                    }
                }
            }

            if (allActivePoolsHaveCutoff && poolLatestFiveStarTime.size > 0) {
                minCutoffTime = Math.min(...Array.from(poolLatestFiveStarTime.values()));
                if (earliestPullAt && earliestPullAt.getTime() > minCutoffTime) {
                    canUseIncrementalWindow = true;
                }
            }
        }

        const pullConditions = [
            eq(pull.userId, userId),
            eq(pull.gameId, gameId),
            eq(pull.gameUid, gameUid),
        ];
        if (canUseIncrementalWindow && minCutoffTime !== null) {
            pullConditions.push(sql`${pull.pulledAt} >= ${minCutoffTime}`);
        }

        const existingDbPulls = await db
            .select({
                pullId: pull.pullId,
                bannerType: pull.bannerType,
                bannerId: pull.bannerId,
                itemId: pull.itemId,
                itemName: pull.itemName,
                itemType: pull.itemType,
                rarity: pull.rarity,
                pulledAt: pull.pulledAt,
                pityAtPull: pull.pityAtPull,
                wasGuaranteed: pull.wasGuaranteed,
                pityVersion: pull.pityVersion,
            })
            .from(pull)
            .where(and(...pullConditions))
            .orderBy(asc(pull.pulledAt));

        const existingNormalizedPulls: NormalizedPull[] = existingDbPulls.map((p) => ({
            pullId: p.pullId,
            gameUid,
            bannerType: p.bannerType,
            ...(p.bannerId ? { bannerId: p.bannerId } : {}),
            itemId: p.itemId,
            itemName: p.itemName,
            itemType: p.itemType,
            rarity: p.rarity,
            pulledAt: p.pulledAt instanceof Date ? p.pulledAt : new Date(p.pulledAt),
            pityAtPull: p.pityAtPull,
            wasGuaranteed: p.wasGuaranteed,
        }));

        const combinedPullsMap = new Map(existingNormalizedPulls.map((p) => [p.pullId, p]));
        for (const p of allPulls) {
            combinedPullsMap.set(p.pullId, p);
        }

        // 2. CPU Pity Calculation performed completely out of transaction lock
        const tPityStart = performance.now();
        const pullsByPool = new Map<string, NormalizedPull[]>();
        for (const p of Array.from(combinedPullsMap.values())) {
            const poolKey = adapter.pityPools?.[p.bannerType] || p.bannerType;
            if (!pullsByPool.has(poolKey)) {
                pullsByPool.set(poolKey, []);
            }
            pullsByPool.get(poolKey)!.push(p);
        }

        const pullsToUpsert: Array<{
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
        let newFourStarCount = 0;
        let newFiveStarCount = 0;
        const newFiveStars: FiveStarHistoryItem[] = [];

        const pityTriggerRarity = adapter?.pityConfig?.pityTriggerRarity ?? 5;
        const pityByPool: Record<string, number> = {};

        for (const [poolKey, poolPulls] of pullsByPool) {
            poolPulls.sort((a, b) => a.pulledAt.getTime() - b.pulledAt.getTime());
            const computedPulls = adapter.computePity(poolPulls, poolKey);

            for (const p of computedPulls) {
                const existing = existingByPullId.get(p.pullId);
                const pityChanged =
                    existing !== undefined &&
                    (existing.pityAtPull !== p.pityAtPull ||
                        existing.wasGuaranteed !== p.wasGuaranteed ||
                        existing.bannerId !== (p.bannerId || null));

                if (existing === undefined) {
                    newPullCount++;
                    if (p.rarity === 5) {
                        newFiveStarCount++;
                        newFiveStars.push({
                            pullId: p.pullId,
                            gameUid,
                            itemId: p.itemId,
                            itemName: p.itemName,
                            pityAtPull: p.pityAtPull,
                            wasGuaranteed: p.wasGuaranteed,
                            pulledAt: p.pulledAt.getTime(),
                            bannerType: p.bannerType,
                            bannerId: p.bannerId || null,
                        });
                    } else if (p.rarity === 4) {
                        newFourStarCount++;
                    }
                }

                if (existing === undefined || pityChanged) {
                    pullsToUpsert.push({
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

                if (p.rarity === pityTriggerRarity) {
                    pityByPool[poolKey] = 0;
                } else {
                    pityByPool[poolKey] = (pityByPool[poolKey] || 0) + 1;
                }
            }
        }

        const currentPityExact: Record<string, number> = {};
        const bannerTypes = adapter?.bannerTypes || Object.keys(pityByPool);
        for (const bannerType of bannerTypes) {
            const poolKey = adapter?.pityPools?.[bannerType] || bannerType;
            currentPityExact[bannerType] = pityByPool[poolKey] || 0;
        }
        for (const [poolKey, count] of Object.entries(pityByPool)) {
            if (currentPityExact[poolKey] === undefined) {
                currentPityExact[poolKey] = count;
            }
        }

        let totalPulls = 0;
        let fourStars = 0;
        let fiveStars = 0;
        let fiveStarHistory: typeof newFiveStars = [];

        if (canUseIncrementalWindow && existingUserGame) {
            totalPulls = existingUserGame.statsTotalPulls + newPullCount;
            fourStars = existingUserGame.statsFourStars + newFourStarCount;
            fiveStars = existingUserGame.statsFiveStars + newFiveStarCount;
            const historyMap = new Map(parsedFiveStarHistory.map((h) => [h.pullId, h]));
            for (const item of newFiveStars) {
                historyMap.set(item.pullId, item);
            }
            fiveStarHistory = Array.from(historyMap.values()).sort(
                (a, b) => b.pulledAt - a.pulledAt
            );
        } else {
            for (const p of Array.from(combinedPullsMap.values())) {
                totalPulls++;
                if (p.rarity === 5) {
                    fiveStars++;
                    fiveStarHistory.push({
                        pullId: p.pullId,
                        gameUid,
                        itemId: p.itemId,
                        itemName: p.itemName,
                        pityAtPull: p.pityAtPull,
                        wasGuaranteed: p.wasGuaranteed,
                        pulledAt: p.pulledAt.getTime(),
                        bannerType: p.bannerType,
                        bannerId: p.bannerId || null,
                    });
                } else if (p.rarity === 4) {
                    fourStars++;
                }
            }
            fiveStarHistory.sort((a, b) => b.pulledAt - a.pulledAt);
        }
        const pityCalcDurationMs = Math.round(performance.now() - tPityStart);

        let existingLatestIds: Record<string, string> = {};
        if (existingUserGame?.latestPullIds) {
            try {
                existingLatestIds = JSON.parse(existingUserGame.latestPullIds);
            } catch {
                existingLatestIds = {};
            }
        }
        const mergedLatestIds = { ...existingLatestIds, ...latestIds };

        // 3. Database operations
        const tDbStart = performance.now();

        const upsertUserGameRecord = async (
            targetDb: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
        ) => {
            await targetDb
                .insert(userGame)
                .values({
                    id: crypto.randomUUID(),
                    userId,
                    gameId,
                    gameUid,
                    nickname: nickname || null,
                    isPrimary: sql`(NOT EXISTS (SELECT 1 FROM user_game WHERE user_id = ${userId} AND game_id = ${gameId}))`,
                    lastImport: new Date(),
                    latestPullIds: JSON.stringify(mergedLatestIds),
                    statsTotalPulls: totalPulls,
                    statsFourStars: fourStars,
                    statsFiveStars: fiveStars,
                    statsCurrentPity: currentPityExact,
                    statsFiveStarHistory: fiveStarHistory,
                })
                .onConflictDoUpdate({
                    target: [userGame.userId, userGame.gameId, userGame.gameUid],
                    set: {
                        lastImport: new Date(),
                        latestPullIds: JSON.stringify(mergedLatestIds),
                        nickname: sql`coalesce(user_game.nickname, excluded.nickname)`,
                        statsTotalPulls: totalPulls,
                        statsFourStars: fourStars,
                        statsFiveStars: fiveStars,
                        statsCurrentPity: currentPityExact,
                        statsFiveStarHistory: fiveStarHistory,
                    },
                });
        };

        if (pullsToUpsert.length === 0) {
            // Bypass transaction lock when no pull rows require insertion or updating
            await upsertUserGameRecord(db);
        } else {
            await db.transaction(async (tx) => {
                const COLUMNS_PER_ROW = 14;
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

                await upsertUserGameRecord(tx);
            });
        }
        const dbWriteDurationMs = Math.round(performance.now() - tDbStart);

        try {
            await redis.set(
                RedisKeys.userGameLatest(userId, gameId, gameUid),
                JSON.stringify(mergedLatestIds),
                "EX",
                86400 * 7
            );
            if (pullsToUpsert.length > 0 || newPullCount > 0) {
                await Promise.all([
                    redis.del(RedisKeys.stats(userId, gameId, gameUid)),
                    redis.del(RedisKeys.stats(userId, gameId, "all")),
                    redis.del(RedisKeys.stats(userId, gameId)),
                ]);
            }
        } catch {
            // Redis caching and cache invalidation are best-effort
        }

        const affectedBanners = new Set(allPulls.map((p) => p.bannerType));

        return {
            imported: newPullCount,
            totalFetched: allPulls.length,
            duplicates: allPulls.length - newPullCount,
            pityCalcDurationMs,
            dbWriteDurationMs,
            earliestPullAt,
            latestPullAt,
            bannersAffectedCount: affectedBanners.size,
        };
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
