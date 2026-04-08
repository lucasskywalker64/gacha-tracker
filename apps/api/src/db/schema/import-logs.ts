import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { users } from "./users";
import { games } from "./games";

/**
 * import_logs
 *
 * One row per import attempt. Created as 'pending' at the start of the import
 * request and updated to 'success', 'partial', or 'failed' on completion.
 */
export const importLogs = sqliteTable(
    "import_logs",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        gameId: text("game_id")
            .notNull()
            .references(() => games.id),
        gameUid: text("game_uid").notNull(),
        initiatedAt: integer("initiated_at")
            .notNull()
            .default(sql`(unixepoch())`),
        completedAt: integer("completed_at"),
        /** 'pending' | 'success' | 'partial' | 'failed' */
        status: text("status").notNull().default("pending"),
        totalFetched: integer("total_fetched"),
        newPulls: integer("new_pulls"),
        duplicates: integer("duplicates"),
        errorMessage: text("error_message"),
        sourceIp: text("source_ip"),
    },
    (table) => [index("idx_import_logs_user").on(table.userId, table.gameId)]
);

export type ImportLog = typeof importLogs.$inferSelect;
export type NewImportLog = typeof importLogs.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const importLogsRelations = relations(importLogs, ({ one }) => ({
    user: one(users, { fields: [importLogs.userId], references: [users.id] }),
    game: one(games, { fields: [importLogs.gameId], references: [games.id] }),
}));
