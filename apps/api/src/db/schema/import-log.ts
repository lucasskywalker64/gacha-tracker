import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { user } from "./user";
import { game } from "./game";

/**
 * import_log
 *
 * One row per completed import attempt ('success', 'partial', or 'failed').
 * Transient in-flight and queue state is tracked in Redis.
 */
export const importLog = sqliteTable(
    "import_log",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        gameId: text("game_id").references(() => game.id),
        gameUid: text("game_uid"),
        initiatedAt: integer("initiated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        completedAt: integer("completed_at", { mode: "timestamp_ms" }),
        /** 'success' | 'partial' | 'failed' */
        status: text("status").notNull(),
        totalFetched: integer("total_fetched"),
        newPulls: integer("new_pulls"),
        duplicates: integer("duplicates"),
        errorMessage: text("error_message"),
        sourceIp: text("source_ip"),

        // Duration metrics (ms)
        scriptDurationMs: integer("script_duration_ms"),
        pityCalcDurationMs: integer("pity_calc_duration_ms"),
        dbWriteDurationMs: integer("db_write_duration_ms"),
        backendDurationMs: integer("backend_duration_ms"),
        queueWaitDurationMs: integer("queue_wait_duration_ms"),
        totalDurationMs: integer("total_duration_ms"),

        // Client metadata & versioning
        importMethod: text("import_method"),
        scriptVersion: text("script_version"),
        webAppVersion: text("web_app_version"),
        fileVersion: text("file_version"),
        userAgent: text("user_agent"),
        payloadSizeBytes: integer("payload_size_bytes"),

        // Pull range & count diagnostics
        earliestPullAt: integer("earliest_pull_at", { mode: "timestamp_ms" }),
        latestPullAt: integer("latest_pull_at", { mode: "timestamp_ms" }),
        bannersAffectedCount: integer("banners_affected_count"),

        // Error diagnostics & observability
        errorCode: text("error_code"),
        rawErrorStack: text("raw_error_stack"),
    },
    (table) => [
        index("idx_import_log_user").on(table.userId, table.gameId),
        check("import_log_status_check", sql`${table.status} IN ('success', 'partial', 'failed')`),
    ]
);

export type ImportLog = typeof importLog.$inferSelect;
export type NewImportLog = typeof importLog.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const importLogRelations = relations(importLog, ({ one }) => ({
    user: one(user, { fields: [importLog.userId], references: [user.id] }),
    game: one(game, { fields: [importLog.gameId], references: [game.id] }),
}));
