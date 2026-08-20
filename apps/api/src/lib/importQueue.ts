import { IMPORT_CONCURRENCY_LIMIT, IMPORT_QUEUE_MAX_DEPTH, IMPORT_RESULT_TTL_MS } from "../config";
import { redis } from "./redis";

export const ImportStatus = {
    QUEUED: "queued",
    PROCESSING: "processing",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled",
    EXPIRED: "expired",
} as const;

export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export interface ImportSummaryItem {
    gameId: string;
    gameUid: string;
    imported: number;
    message: string;
    success: boolean;
}

export interface QueueEntry {
    requestId: string;
    userId: string;
    queuedAt: Date;
    completedAt?: Date;
    status: ImportStatus;
    buffer: Buffer;
    format: string;
    gameUid?: string;
    profileUids?: Record<string, string>;
    result?: ImportSummaryItem[];
    error?: string;
}

export interface QueueSnapshot {
    status: ImportStatus;
    position: number | null; // 1-indexed, null if not queued
    waitedSeconds: number;
    result?: ImportSummaryItem[];
    error?: string;
}

const store = new Map<string, QueueEntry>();
let runningCount = 0;
let worker: ((entry: QueueEntry) => Promise<ImportSummaryItem[]>) | null = null;
let defaultWorker: ((entry: QueueEntry) => Promise<ImportSummaryItem[]>) | null = null;

export function registerWorker(fn: (entry: QueueEntry) => Promise<ImportSummaryItem[]>) {
    if (!defaultWorker) {
        defaultWorker = fn;
    }
    worker = fn;
}

async function persistTaskToRedis(entry: QueueEntry) {
    try {
        const key = `import_task:${entry.requestId}`;
        const data: Record<string, string> = {
            requestId: entry.requestId,
            userId: entry.userId,
            queuedAt: entry.queuedAt.toISOString(),
            status: entry.status,
            format: entry.format,
        };
        if (entry.completedAt) data.completedAt = entry.completedAt.toISOString();
        if (entry.gameUid) data.gameUid = entry.gameUid;
        if (entry.profileUids) data.profileUids = JSON.stringify(entry.profileUids);
        if (entry.result) data.result = JSON.stringify(entry.result);
        if (entry.error) data.error = entry.error;

        const isTerminal =
            entry.status === ImportStatus.DONE ||
            entry.status === ImportStatus.FAILED ||
            entry.status === ImportStatus.CANCELLED;

        const pipe = redis.pipeline();
        pipe.hset(key, data);

        if (isTerminal) {
            pipe.expire(key, Math.ceil(IMPORT_RESULT_TTL_MS / 1000));
            pipe.del(`import_task_buffer:${entry.requestId}`);
            pipe.srem("import_tasks_active", entry.requestId);
        } else {
            pipe.expire(key, 86400); // 24h fallback TTL for active tasks
            pipe.sadd("import_tasks_active", entry.requestId);

            // Persist raw file buffer in Redis while job is QUEUED or PROCESSING so restarts can recover it
            if (entry.buffer && entry.buffer.length > 0) {
                const bufKey = `import_task_buffer:${entry.requestId}`;
                pipe.set(bufKey, entry.buffer.toString("base64"), "EX", 86400);
            }
        }

        await pipe.exec();
    } catch {
        // Fallback silently if Redis is offline
    }
}

async function loadTaskFromRedis(requestId: string): Promise<QueueEntry | null> {
    try {
        const key = `import_task:${requestId}`;
        const data = await redis.hgetall(key);
        if (!data || !data.requestId) return null;

        const bufKey = `import_task_buffer:${requestId}`;
        const b64 = await redis.get(bufKey);
        const buffer = b64 ? Buffer.from(b64, "base64") : Buffer.alloc(0);

        let status = data.status as ImportStatus;
        let error = data.error || undefined;

        // If a task in Redis is marked "processing" but local memory doesn't have it active,
        // it means the previous server process crashed/restarted mid-execution. Mark it failed.
        if (status === ImportStatus.PROCESSING && !store.has(requestId)) {
            status = ImportStatus.FAILED;
            error = "Process restarted while task was processing.";
        }

        return {
            requestId: data.requestId,
            userId: data.userId,
            queuedAt: new Date(data.queuedAt),
            completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
            status,
            format: data.format,
            gameUid: data.gameUid || undefined,
            profileUids: data.profileUids ? JSON.parse(data.profileUids) : undefined,
            buffer,
            result: data.result ? JSON.parse(data.result) : undefined,
            error,
        };
    } catch {
        return null;
    }
}

async function recoverQueuedTasksFromRedis() {
    try {
        const activeIds = await redis.smembers("import_tasks_active");
        for (const id of activeIds) {
            if (!store.has(id)) {
                const entry = await loadTaskFromRedis(id);
                if (
                    entry &&
                    (entry.status === ImportStatus.QUEUED ||
                        entry.status === ImportStatus.PROCESSING)
                ) {
                    // If buffer is missing (expired or lost), mark failed
                    if (entry.buffer.length === 0 && entry.status === ImportStatus.QUEUED) {
                        entry.status = ImportStatus.FAILED;
                        entry.error = "Payload expired after server restart.";
                        await persistTaskToRedis(entry);
                    } else {
                        store.set(entry.requestId, entry);
                    }
                }
            }
        }
    } catch {
        // Fallback silently if Redis is offline
    }
}

export function enqueue(entry: Omit<QueueEntry, "queuedAt" | "status">): QueueEntry {
    const currentlyQueued = Array.from(store.values()).filter(
        (e) => e.status === ImportStatus.QUEUED
    ).length;
    if (currentlyQueued >= IMPORT_QUEUE_MAX_DEPTH) {
        throw new Error("QUEUE_FULL");
    }

    const newEntry: QueueEntry = {
        ...entry,
        queuedAt: new Date(),
        status: ImportStatus.QUEUED,
    };

    store.set(newEntry.requestId, newEntry);
    persistTaskToRedis(newEntry);
    processQueue();
    return newEntry;
}

export async function getRequestOwner(requestId: string): Promise<string | null> {
    const entry = store.get(requestId);
    if (entry) return entry.userId;

    const redisTask = await loadTaskFromRedis(requestId);
    return redisTask ? redisTask.userId : null;
}

export async function getStatus(requestId: string): Promise<QueueSnapshot | null> {
    let entry = store.get(requestId);
    if (!entry) {
        entry = (await loadTaskFromRedis(requestId)) ?? undefined;
    }
    if (!entry) return null;

    const endedAt = entry.completedAt || new Date();
    const waitedSeconds = Math.max(
        0,
        Math.floor((endedAt.getTime() - entry.queuedAt.getTime()) / 1000)
    );

    let position: number | null = null;
    if (entry.status === ImportStatus.QUEUED) {
        const queuedEntries = Array.from(store.values()).filter(
            (e) => e.status === ImportStatus.QUEUED
        );
        const idx = queuedEntries.findIndex((e) => e.requestId === requestId);
        position = idx === -1 ? null : idx + 1;
    }

    return {
        status: entry.status,
        position,
        waitedSeconds,
        result: entry.result,
        error: entry.error,
    };
}

export async function cancel(requestId: string, userId: string): Promise<boolean> {
    let entry = store.get(requestId);
    if (!entry) {
        entry = (await loadTaskFromRedis(requestId)) ?? undefined;
    }
    if (!entry || entry.userId !== userId) return false;

    if (entry.status !== ImportStatus.QUEUED) {
        return false;
    }

    entry.status = ImportStatus.CANCELLED;
    entry.completedAt = new Date();
    entry.buffer = Buffer.alloc(0);

    store.set(requestId, entry);
    await persistTaskToRedis(entry);

    setTimeout(() => {
        store.delete(requestId);
    }, IMPORT_RESULT_TTL_MS);

    processQueue();
    return true;
}

async function processQueue() {
    if (runningCount >= IMPORT_CONCURRENCY_LIMIT || !worker) {
        return;
    }

    // Attempt task recovery if local store is empty of queued entries
    const hasLocalQueued = Array.from(store.values()).some((e) => e.status === ImportStatus.QUEUED);
    if (!hasLocalQueued) {
        await recoverQueuedTasksFromRedis();
    }

    const nextEntry = Array.from(store.values())
        .filter((e) => e.status === ImportStatus.QUEUED)
        .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())
        .at(0);

    if (!nextEntry) {
        return;
    }

    nextEntry.status = ImportStatus.PROCESSING;
    runningCount++;
    persistTaskToRedis(nextEntry);

    const currentWorker = worker;
    try {
        const summary = await currentWorker(nextEntry);
        nextEntry.status = ImportStatus.DONE;
        nextEntry.result = summary;
    } catch (err) {
        nextEntry.status = ImportStatus.FAILED;
        nextEntry.error = err instanceof Error ? err.message : String(err);
    } finally {
        nextEntry.completedAt = new Date();
        nextEntry.buffer = Buffer.alloc(0);
        runningCount = Math.max(0, runningCount - 1);
        persistTaskToRedis(nextEntry);

        const idToEvict = nextEntry.requestId;
        setTimeout(() => {
            store.delete(idToEvict);
        }, IMPORT_RESULT_TTL_MS);

        processQueue();
    }
}

export function _reset() {
    store.clear();
    runningCount = 0;
    worker = defaultWorker;
}

export function _getQueueState() {
    const entries = Array.from(store.values());
    return {
        running: runningCount,
        queued: entries.filter((e) => e.status === ImportStatus.QUEUED).length,
        total: entries.length,
    };
}
