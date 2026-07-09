import { IMPORT_CONCURRENCY_LIMIT, IMPORT_QUEUE_MAX_DEPTH, IMPORT_RESULT_TTL_MS } from "../config";

export const ImportStatus = {
    QUEUED: "queued",
    PROCESSING: "processing",
    DONE: "done",
    FAILED: "failed",
    CANCELLED: "cancelled",
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
    processQueue();
    return newEntry;
}

export function getRequestOwner(requestId: string): string | null {
    const entry = store.get(requestId);
    return entry ? entry.userId : null;
}

export function getStatus(requestId: string): QueueSnapshot | null {
    const entry = store.get(requestId);
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

export function cancel(requestId: string, userId: string): boolean {
    const entry = store.get(requestId);
    if (!entry || entry.userId !== userId) return false;

    if (entry.status !== ImportStatus.QUEUED) {
        return false;
    }

    entry.status = ImportStatus.CANCELLED;
    entry.completedAt = new Date();
    // Clean up the buffer to release memory immediately
    entry.buffer = Buffer.alloc(0);

    // Evict after TTL
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

    // Find the next queued entry (FIFO)
    const nextEntry = Array.from(store.values())
        .filter((e) => e.status === ImportStatus.QUEUED)
        .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())
        .at(0);

    if (!nextEntry) {
        return;
    }

    nextEntry.status = ImportStatus.PROCESSING;
    runningCount++;

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
        // Free up memory immediately
        nextEntry.buffer = Buffer.alloc(0);
        runningCount = Math.max(0, runningCount - 1);

        // Schedule eviction
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
