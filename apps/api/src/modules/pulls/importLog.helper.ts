import { db } from "../../db/client";
import { importLog } from "../../db/schema/import-log";
import { redis } from "../../lib/redis";

export interface CreateImportLogParams {
    id?: string;
    userId: string;
    gameId?: string;
    gameUid?: string;
    importMethod: string;
    sourceIp?: string;
    userAgent?: string;
    scriptVersion?: string;
    webAppVersion?: string;
    fileVersion?: string;
    payloadSizeBytes?: number;
    scriptDurationMs?: number;
    queueWaitDurationMs?: number;
    initiatedAt?: Date;
}

export interface UpdateSuccessImportLogParams {
    userId?: string;
    importMethod?: string;
    sourceIp?: string;
    userAgent?: string;
    payloadSizeBytes?: number;
    gameId?: string;
    gameUid?: string;
    totalFetched?: number;
    newPulls?: number;
    duplicates?: number;
    pityCalcDurationMs?: number;
    dbWriteDurationMs?: number;
    backendDurationMs?: number;
    scriptDurationMs?: number;
    queueWaitDurationMs?: number;
    totalDurationMs?: number;
    earliestPullAt?: Date;
    latestPullAt?: Date;
    bannersAffectedCount?: number;
    scriptVersion?: string;
    webAppVersion?: string;
    fileVersion?: string;
    initiatedAt?: Date;
    tBackendStart?: number;
}

export interface UpdateFailedImportLogParams {
    userId?: string;
    gameId?: string;
    gameUid?: string;
    importMethod?: string;
    sourceIp?: string;
    userAgent?: string;
    payloadSizeBytes?: number;
    errorMessage: string;
    errorCode?: string;
    rawErrorStack?: string;
    backendDurationMs?: number;
    scriptDurationMs?: number;
    queueWaitDurationMs?: number;
    totalDurationMs?: number;
    scriptVersion?: string;
    webAppVersion?: string;
    fileVersion?: string;
    initiatedAt?: Date;
    tBackendStart?: number;
}

const pendingLogStore = new Map<string, CreateImportLogParams>();

export async function createPendingImportLog(params: CreateImportLogParams): Promise<string> {
    const id = params.id || crypto.randomUUID();
    const initiatedAt = params.initiatedAt || new Date();

    const logParams: CreateImportLogParams = {
        ...params,
        id,
        initiatedAt,
    };

    pendingLogStore.set(id, logParams);

    try {
        await redis.set(
            `pending_import_log:${id}`,
            JSON.stringify({
                ...logParams,
                initiatedAt: initiatedAt.toISOString(),
            }),
            "EX",
            3600
        );
    } catch {
        // Redis persistence is best-effort
    }

    // Auto cleanup after 15 minutes to prevent memory leaks if an import crashes unexpectedly
    const timer = setTimeout(
        () => {
            pendingLogStore.delete(id);
        },
        15 * 60 * 1000
    );
    if (typeof timer.unref === "function") {
        timer.unref();
    }

    return id;
}

export async function deletePendingLog(id: string): Promise<void> {
    pendingLogStore.delete(id);
    try {
        await redis.del(`pending_import_log:${id}`);
    } catch {
        // Best-effort redis delete
    }
}

async function getPendingLog(id: string): Promise<CreateImportLogParams | undefined> {
    const local = pendingLogStore.get(id);
    if (local) {
        pendingLogStore.delete(id);
        try {
            await redis.del(`pending_import_log:${id}`);
        } catch {
            // Best-effort redis delete
        }
        return local;
    }

    try {
        const raw = await redis.get(`pending_import_log:${id}`);
        if (raw) {
            await redis.del(`pending_import_log:${id}`);
            const parsed = JSON.parse(raw);
            return {
                ...parsed,
                initiatedAt: parsed.initiatedAt ? new Date(parsed.initiatedAt) : undefined,
            };
        }
    } catch {
        // Fallback silently if Redis is offline
    }

    return undefined;
}

export async function updateSuccessImportLog(
    id: string,
    params: UpdateSuccessImportLogParams
): Promise<void> {
    const pending = await getPendingLog(id);

    const initiatedAt = params.initiatedAt || pending?.initiatedAt || new Date();
    const completedAt = new Date();

    const backendDurationMs =
        params.tBackendStart !== undefined
            ? Math.max(0, Math.round(performance.now() - params.tBackendStart))
            : params.backendDurationMs !== undefined
              ? Math.max(0, Math.round(params.backendDurationMs))
              : undefined;

    const scriptDurationMs =
        params.scriptDurationMs !== undefined
            ? Math.max(0, Math.round(params.scriptDurationMs))
            : pending?.scriptDurationMs;

    const queueWaitDurationMs =
        params.queueWaitDurationMs !== undefined
            ? Math.max(0, Math.round(params.queueWaitDurationMs))
            : pending?.queueWaitDurationMs;

    const totalDurationMs =
        params.totalDurationMs !== undefined
            ? Math.max(0, Math.round(params.totalDurationMs))
            : (scriptDurationMs ?? 0) + (queueWaitDurationMs ?? 0) + (backendDurationMs ?? 0);

    try {
        await db.insert(importLog).values({
            id,
            userId: params.userId || pending?.userId || "unknown",
            gameId: params.gameId || pending?.gameId || null,
            gameUid: params.gameUid || pending?.gameUid || null,
            importMethod: params.importMethod || pending?.importMethod || "unknown",
            status: "success",
            sourceIp: params.sourceIp ?? pending?.sourceIp ?? null,
            userAgent: params.userAgent ?? pending?.userAgent ?? null,
            scriptVersion: params.scriptVersion || pending?.scriptVersion || null,
            webAppVersion: params.webAppVersion || pending?.webAppVersion || null,
            fileVersion: params.fileVersion || pending?.fileVersion || null,
            payloadSizeBytes: params.payloadSizeBytes ?? pending?.payloadSizeBytes ?? null,
            scriptDurationMs: scriptDurationMs ?? null,
            queueWaitDurationMs: queueWaitDurationMs ?? null,
            pityCalcDurationMs:
                params.pityCalcDurationMs !== undefined
                    ? Math.max(0, Math.round(params.pityCalcDurationMs))
                    : null,
            dbWriteDurationMs:
                params.dbWriteDurationMs !== undefined
                    ? Math.max(0, Math.round(params.dbWriteDurationMs))
                    : null,
            backendDurationMs: backendDurationMs ?? null,
            totalDurationMs: totalDurationMs ?? null,
            totalFetched: params.totalFetched ?? null,
            newPulls: params.newPulls ?? null,
            duplicates: params.duplicates ?? null,
            earliestPullAt: params.earliestPullAt || null,
            latestPullAt: params.latestPullAt || null,
            bannersAffectedCount: params.bannersAffectedCount ?? null,
            initiatedAt,
            completedAt,
        });
    } catch (err) {
        console.error("[importLog] Failed to insert success import log:", err);
    }
}

export async function updateFailedImportLog(
    id: string,
    params: UpdateFailedImportLogParams
): Promise<void> {
    const pending = await getPendingLog(id);

    const initiatedAt = params.initiatedAt || pending?.initiatedAt || new Date();
    const completedAt = new Date();

    const backendDurationMs =
        params.tBackendStart !== undefined
            ? Math.max(0, Math.round(performance.now() - params.tBackendStart))
            : params.backendDurationMs !== undefined
              ? Math.max(0, Math.round(params.backendDurationMs))
              : undefined;

    const scriptDurationMs =
        params.scriptDurationMs !== undefined
            ? Math.max(0, Math.round(params.scriptDurationMs))
            : pending?.scriptDurationMs;

    const queueWaitDurationMs =
        params.queueWaitDurationMs !== undefined
            ? Math.max(0, Math.round(params.queueWaitDurationMs))
            : pending?.queueWaitDurationMs;

    const totalDurationMs =
        params.totalDurationMs !== undefined
            ? Math.max(0, Math.round(params.totalDurationMs))
            : (scriptDurationMs ?? 0) + (queueWaitDurationMs ?? 0) + (backendDurationMs ?? 0);

    try {
        await db.insert(importLog).values({
            id,
            userId: params.userId || pending?.userId || "unknown",
            gameId: params.gameId || pending?.gameId || null,
            gameUid: params.gameUid || pending?.gameUid || null,
            importMethod: params.importMethod || pending?.importMethod || "unknown",
            status: "failed",
            sourceIp: params.sourceIp ?? pending?.sourceIp ?? null,
            userAgent: params.userAgent ?? pending?.userAgent ?? null,
            scriptVersion: params.scriptVersion || pending?.scriptVersion || null,
            webAppVersion: params.webAppVersion || pending?.webAppVersion || null,
            fileVersion: params.fileVersion || pending?.fileVersion || null,
            payloadSizeBytes: params.payloadSizeBytes ?? pending?.payloadSizeBytes ?? null,
            scriptDurationMs: scriptDurationMs ?? null,
            queueWaitDurationMs: queueWaitDurationMs ?? null,
            backendDurationMs: backendDurationMs ?? null,
            totalDurationMs: totalDurationMs ?? null,
            errorMessage: params.errorMessage,
            errorCode: params.errorCode || null,
            rawErrorStack: params.rawErrorStack || null,
            initiatedAt,
            completedAt,
        });
    } catch (err) {
        console.error("[importLog] Failed to insert failed import log:", err);
    }
}
