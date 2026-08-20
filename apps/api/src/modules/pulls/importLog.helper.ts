import { db } from "../../db/client";
import { importLog } from "../../db/schema/import-log";

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

export async function updateSuccessImportLog(
    id: string,
    params: UpdateSuccessImportLogParams
): Promise<void> {
    const pending = pendingLogStore.get(id);
    pendingLogStore.delete(id);

    const initiatedAt = params.initiatedAt || pending?.initiatedAt || new Date();
    const completedAt = new Date();

    const backendDurationMs = params.tBackendStart
        ? Math.max(0, Math.round(performance.now() - params.tBackendStart))
        : params.backendDurationMs !== undefined
          ? Math.max(0, Math.round(params.backendDurationMs))
          : undefined;

    const scriptDurationMs =
        params.scriptDurationMs !== undefined
            ? Math.max(0, Math.round(params.scriptDurationMs))
            : pending?.scriptDurationMs || 0;

    const queueWaitDurationMs =
        params.queueWaitDurationMs !== undefined
            ? Math.max(0, Math.round(params.queueWaitDurationMs))
            : pending?.queueWaitDurationMs || 0;

    const totalDurationMs =
        params.totalDurationMs !== undefined
            ? Math.max(0, Math.round(params.totalDurationMs))
            : scriptDurationMs + queueWaitDurationMs + (backendDurationMs || 0);

    try {
        await db.insert(importLog).values({
            id,
            userId: pending?.userId || "unknown",
            gameId: params.gameId || pending?.gameId || null,
            gameUid: params.gameUid || pending?.gameUid || null,
            importMethod: pending?.importMethod || "unknown",
            status: "success",
            sourceIp: pending?.sourceIp || null,
            userAgent: pending?.userAgent || null,
            scriptVersion: params.scriptVersion || pending?.scriptVersion || null,
            webAppVersion: params.webAppVersion || pending?.webAppVersion || null,
            fileVersion: params.fileVersion || pending?.fileVersion || null,
            payloadSizeBytes: pending?.payloadSizeBytes ?? null,
            scriptDurationMs: scriptDurationMs || null,
            queueWaitDurationMs: queueWaitDurationMs || null,
            pityCalcDurationMs:
                params.pityCalcDurationMs !== undefined
                    ? Math.max(0, Math.round(params.pityCalcDurationMs))
                    : null,
            dbWriteDurationMs:
                params.dbWriteDurationMs !== undefined
                    ? Math.max(0, Math.round(params.dbWriteDurationMs))
                    : null,
            backendDurationMs: backendDurationMs ?? null,
            totalDurationMs: totalDurationMs || null,
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
    const pending = pendingLogStore.get(id);
    pendingLogStore.delete(id);

    const initiatedAt = params.initiatedAt || pending?.initiatedAt || new Date();
    const completedAt = new Date();

    const backendDurationMs = params.tBackendStart
        ? Math.max(0, Math.round(performance.now() - params.tBackendStart))
        : params.backendDurationMs !== undefined
          ? Math.max(0, Math.round(params.backendDurationMs))
          : undefined;

    const scriptDurationMs =
        params.scriptDurationMs !== undefined
            ? Math.max(0, Math.round(params.scriptDurationMs))
            : pending?.scriptDurationMs || 0;

    const queueWaitDurationMs =
        params.queueWaitDurationMs !== undefined
            ? Math.max(0, Math.round(params.queueWaitDurationMs))
            : pending?.queueWaitDurationMs || 0;

    const totalDurationMs =
        params.totalDurationMs !== undefined
            ? Math.max(0, Math.round(params.totalDurationMs))
            : scriptDurationMs + queueWaitDurationMs + (backendDurationMs || 0);

    try {
        await db.insert(importLog).values({
            id,
            userId: pending?.userId || "unknown",
            gameId: pending?.gameId || null,
            gameUid: pending?.gameUid || null,
            importMethod: pending?.importMethod || "unknown",
            status: "failed",
            sourceIp: pending?.sourceIp || null,
            userAgent: pending?.userAgent || null,
            scriptVersion: params.scriptVersion || pending?.scriptVersion || null,
            webAppVersion: params.webAppVersion || pending?.webAppVersion || null,
            fileVersion: params.fileVersion || pending?.fileVersion || null,
            payloadSizeBytes: pending?.payloadSizeBytes ?? null,
            scriptDurationMs: scriptDurationMs || null,
            queueWaitDurationMs: queueWaitDurationMs || null,
            backendDurationMs: backendDurationMs ?? null,
            totalDurationMs: totalDurationMs || null,
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
