import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { users } from "./users";
import { games } from "./games";

// ---------------------------------------------------------------------------
// user_games
// One row per user per game. Created automatically on first import.
// ---------------------------------------------------------------------------
export const userGames = sqliteTable(
  "user_games",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    lastImport: integer("last_import"),
    /**
     * JSON object mapping banner type → most recent successfully imported
     * pull ID for that banner.  null until the first successful import.
     * e.g. '{"character":"123","weapon":"456"}'
     */
    latestPullIds: text("latest_pull_ids"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("user_games_user_game_idx").on(table.userId, table.gameId),
    index("idx_user_games_user").on(table.userId),
  ],
);

export type UserGame = typeof userGames.$inferSelect;
export type NewUserGame = typeof userGames.$inferInsert;

// ---------------------------------------------------------------------------
// pulls
// Immutable raw pull records. Computed pity fields may be recomputed by
// migration when pity logic changes but raw pull fields are never modified.
// ---------------------------------------------------------------------------
export const pulls = sqliteTable(
  "pulls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    gameUid: text("game_uid").notNull(),
    pullId: text("pull_id").notNull(),
    bannerType: text("banner_type").notNull(),
    bannerId: text("banner_id"),
    itemId: text("item_id").notNull(),
    itemName: text("item_name").notNull(),
    itemType: text("item_type").notNull(),
    rarity: integer("rarity").notNull(),
    pulledAt: integer("pulled_at").notNull(),
    pityAtPull: integer("pity_at_pull").notNull(),
    wasGuaranteed: integer("was_guaranteed").notNull(),
    /**
     * Incremented when pity computation logic changes so affected rows can be
     * identified and recomputed via a migration without a re-import.
     */
    pityVersion: integer("pity_version").notNull().default(1),
    /** Game-specific overflow / extra data serialised as JSON. */
    extra: text("extra"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // Deduplication — the UNIQUE constraint also doubles as an index.
    uniqueIndex("pulls_dedup_idx").on(table.userId, table.gameId, table.pullId),
    index("idx_pulls_user_game").on(table.userId, table.gameId),
    index("idx_pulls_game_banner").on(table.gameId, table.bannerType),
    index("idx_pulls_pulled_at").on(table.pulledAt),
    index("idx_pulls_rarity").on(table.rarity),
  ],
);

export type Pull = typeof pulls.$inferSelect;
export type NewPull = typeof pulls.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const userGamesRelations = relations(userGames, ({ one }) => ({
  user: one(users, { fields: [userGames.userId], references: [users.id] }),
  game: one(games, { fields: [userGames.gameId], references: [games.id] }),
}));

export const pullsRelations = relations(pulls, ({ one }) => ({
  user: one(users, { fields: [pulls.userId], references: [users.id] }),
  game: one(games, { fields: [pulls.gameId], references: [games.id] }),
}));
