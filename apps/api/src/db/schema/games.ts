import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Games supported by the tracker.
 *
 * Each game has a unique ID (e.g. 'genshin', 'hsr', 'zzz', 'wuwa') and
 * a display name. The `config` column holds game-specific settings, such as
 * banner rotation schedules, banner types, and other metadata.
 *
 * The `isActive` flag allows games to be enabled or disabled without deleting
 * them from the database.
 */
export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  iconUrl: text("icon_url"),
  isActive: integer("is_active").notNull().default(1),
  config: text("config").notNull().default("{}"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});