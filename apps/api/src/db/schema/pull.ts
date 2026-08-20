import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { user } from "./user";
import { game } from "./game";

// ---------------------------------------------------------------------------
// user_game
// One row per user per game. Created automatically on first import.
// ---------------------------------------------------------------------------
export const userGame = sqliteTable(
    "user_game",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        gameId: text("game_id")
            .notNull()
            .references(() => game.id),
        gameUid: text("game_uid").notNull(),
        nickname: text("nickname"),
        isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
        lastImport: integer("last_import", { mode: "timestamp_ms" }),
        /**
         * JSON object mapping banner type → most recent successfully imported
         * pull ID for that banner.  null until the first successful import.
         * e.g. '{"character":"123","weapon":"456"}'
         */
        latestPullIds: text("latest_pull_ids"),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [
        uniqueIndex("user_game_user_game_uid_idx").on(table.userId, table.gameId, table.gameUid),
        uniqueIndex("idx_user_game_primary")
            .on(table.userId, table.gameId)
            .where(sql`${table.isPrimary} = 1`),
        index("idx_user_game_user").on(table.userId),
        index("idx_user_game_user_game").on(table.userId, table.gameId),
    ]
);

export type UserGame = typeof userGame.$inferSelect;
export type NewUserGame = typeof userGame.$inferInsert;

// ---------------------------------------------------------------------------
// pull
// Immutable raw pull records. Computed pity fields may be recomputed by
// migration when pity logic changes but raw pull fields are never modified.
// ---------------------------------------------------------------------------
export const pull = sqliteTable(
    "pull",
    {
        id: text("id").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        gameId: text("game_id")
            .notNull()
            .references(() => game.id),
        gameUid: text("game_uid").notNull(),
        pullId: text("pull_id").notNull(),
        bannerType: text("banner_type").notNull(),
        bannerId: text("banner_id"),
        itemId: text("item_id").notNull(),
        itemName: text("item_name").notNull(),
        itemType: text("item_type").notNull(),
        rarity: integer("rarity").notNull(),
        pulledAt: integer("pulled_at", { mode: "timestamp_ms" }).notNull(),
        pityAtPull: integer("pity_at_pull").notNull(),
        wasGuaranteed: integer("was_guaranteed").notNull(),
        /**
         * Incremented when pity computation logic changes so affected rows can be
         * identified and recomputed via a migration without a re-import.
         */
        pityVersion: integer("pity_version").notNull().default(1),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [
        // Deduplication — the UNIQUE constraint also doubles as an index.
        uniqueIndex("pull_dedup_idx").on(table.userId, table.gameId, table.gameUid, table.pullId),
        index("idx_pull_user_game").on(table.userId, table.gameId),
        index("idx_pull_user_game_uid").on(table.userId, table.gameId, table.gameUid),
        index("idx_pull_game_banner").on(table.gameId, table.bannerType),
        index("idx_pull_pulled_at").on(table.pulledAt),
        index("idx_pull_rarity").on(table.rarity),
    ]
);

export type Pull = typeof pull.$inferSelect;
export type NewPull = typeof pull.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const userGameRelations = relations(userGame, ({ one }) => ({
    user: one(user, { fields: [userGame.userId], references: [user.id] }),
    game: one(game, { fields: [userGame.gameId], references: [game.id] }),
}));

export const pullRelations = relations(pull, ({ one }) => ({
    user: one(user, { fields: [pull.userId], references: [user.id] }),
    game: one(game, { fields: [pull.gameId], references: [game.id] }),
}));
