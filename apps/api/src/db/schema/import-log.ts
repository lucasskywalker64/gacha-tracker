import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { user } from "./user";
import { game } from "./game";

/**
 * import_log
 *
 * One row per import attempt. Created as 'pending' at the start of the import
 * request and updated to 'success', 'partial', or 'failed' on completion.
 */
export const importLog = sqliteTable(
    "import_log",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        gameId: text("game_id")
            .notNull()
            .references(() => game.id),
        gameUid: text("game_uid").notNull(),
        initiatedAt: integer("initiated_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
        completedAt: integer("completed_at", { mode: "timestamp_ms" }),
        /** 'pending' | 'success' | 'partial' | 'failed' */
        status: text("status").notNull().default("pending"),
        totalFetched: integer("total_fetched"),
        newPulls: integer("new_pulls"),
        duplicates: integer("duplicates"),
        errorMessage: text("error_message"),
        sourceIp: text("source_ip"),
    },
    (table) => [index("idx_import_log_user").on(table.userId, table.gameId)]
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
