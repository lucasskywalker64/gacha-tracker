import type { Client } from "@libsql/client";

export async function createTestTables(sqlite: Client) {
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified INTEGER, image TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER, code_hash TEXT, is_anonymous INTEGER, role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT, ban_expires INTEGER)`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS game (id TEXT PRIMARY KEY, display_name TEXT, icon_url TEXT, is_active INTEGER, config TEXT, created_at INTEGER)`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS user_game (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, game_uid TEXT NOT NULL, nickname TEXT, is_primary INTEGER NOT NULL DEFAULT 0, last_import INTEGER, latest_pull_ids TEXT, created_at INTEGER)`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS pull (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, game_uid TEXT NOT NULL, pull_id TEXT, banner_type TEXT, banner_id TEXT, item_id TEXT, item_name TEXT, item_type TEXT, rarity INTEGER, pulled_at INTEGER, pity_at_pull INTEGER, was_guaranteed INTEGER, pity_version INTEGER, created_at INTEGER)`
    );

    // Add required indexes for ON CONFLICT
    await sqlite.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS user_game_user_game_uid_idx ON user_game (user_id, game_id, game_uid)`
    );
    await sqlite.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS user_game_user_game_primary_idx ON user_game (user_id, game_id) WHERE is_primary = 1`
    );
    await sqlite.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS pull_dedup_idx ON pull (user_id, game_id, game_uid, pull_id)`
    );
}
