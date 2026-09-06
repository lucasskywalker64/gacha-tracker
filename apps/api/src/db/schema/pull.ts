import {
    sqliteTable,
    text,
    integer,
    uniqueIndex,
    index,
    primaryKey,
} from "drizzle-orm/sqlite-core";
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
         * pull ID for that banner. null until the first successful import.
         * e.g. '{"character":"123","weapon":"456"}'
         */
        latestPullIds: text("latest_pull_ids"),
        statsTotalPulls: integer("stats_total_pulls").notNull().default(0),
        statsFourStars: integer("stats_four_stars").notNull().default(0),
        statsFiveStars: integer("stats_five_stars").notNull().default(0),
        /** JSON mapping banner type to active pity count */
        statsCurrentPity: text("stats_current_pity", { mode: "json" }).$type<
            Record<string, number>
        >(),
        /** JSON array of recent 5-star pulls */
        statsFiveStarHistory: text("stats_five_star_history", { mode: "json" }).$type<
            FiveStarHistoryItem[]
        >(),
        createdAt: integer("created_at", { mode: "timestamp_ms" })
            .notNull()
            .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    },
    (table) => [
        uniqueIndex("user_game_user_game_uid_idx").on(table.userId, table.gameId, table.gameUid),
        uniqueIndex("idx_user_game_primary")
            .on(table.userId, table.gameId)
            .where(sql`${table.isPrimary} = 1`),
    ]
);

export interface FiveStarHistoryItem {
    pullId: string;
    gameUid: string;
    itemId: string;
    itemName: string;
    pityAtPull: number;
    wasGuaranteed: number;
    pulledAt: number;
    bannerType: string;
    bannerId?: string | null;
}

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
        primaryKey({ columns: [table.userId, table.gameId, table.gameUid, table.pullId] }),
        index("idx_pull_user_game_date").on(
            table.userId,
            table.gameId,
            table.pulledAt,
            table.pullId,
            table.gameUid
        ),
        index("idx_pull_user_game_uid_date").on(
            table.userId,
            table.gameId,
            table.gameUid,
            table.pulledAt,
            table.pullId
        ),
        index("idx_pull_filter_sort").on(
            table.userId,
            table.gameId,
            table.gameUid,
            table.bannerType,
            table.pulledAt,
            table.pullId
        ),
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
