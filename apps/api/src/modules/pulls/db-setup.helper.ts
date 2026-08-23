import type { Client } from "@libsql/client";

export async function createTestTables(sqlite: Client) {
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT, email TEXT, email_verified INTEGER, image TEXT, created_at INTEGER, updated_at INTEGER, code_hash TEXT, is_anonymous INTEGER, role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT, ban_expires INTEGER, theme TEXT NOT NULL DEFAULT 'system', pity_display_mode TEXT NOT NULL DEFAULT 'count_up')`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS game (id TEXT PRIMARY KEY, display_name TEXT, icon_url TEXT, is_active INTEGER, config TEXT, created_at INTEGER)`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS user_game (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, game_uid TEXT NOT NULL, nickname TEXT, is_primary INTEGER NOT NULL DEFAULT 0, last_import INTEGER, latest_pull_ids TEXT, stats_total_pulls INTEGER NOT NULL DEFAULT 0, stats_four_stars INTEGER NOT NULL DEFAULT 0, stats_five_stars INTEGER NOT NULL DEFAULT 0, stats_current_pity TEXT, stats_five_star_history TEXT, created_at INTEGER)`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS pull (user_id TEXT NOT NULL, game_id TEXT NOT NULL, game_uid TEXT NOT NULL, pull_id TEXT NOT NULL, banner_type TEXT NOT NULL, banner_id TEXT, item_id TEXT NOT NULL, item_name TEXT NOT NULL, item_type TEXT NOT NULL, rarity INTEGER NOT NULL, pulled_at INTEGER NOT NULL, pity_at_pull INTEGER NOT NULL, was_guaranteed INTEGER NOT NULL, pity_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER, PRIMARY KEY (user_id, game_id, game_uid, pull_id))`
    );
    await sqlite.execute(
        `CREATE TABLE IF NOT EXISTS import_log (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_id TEXT, game_uid TEXT, initiated_at INTEGER NOT NULL, completed_at INTEGER, status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')), total_fetched INTEGER, new_pulls INTEGER, duplicates INTEGER, error_message TEXT, source_ip TEXT, script_duration_ms INTEGER, pity_calc_duration_ms INTEGER, db_write_duration_ms INTEGER, backend_duration_ms INTEGER, queue_wait_duration_ms INTEGER, total_duration_ms INTEGER, import_method TEXT, script_version TEXT, web_app_version TEXT, file_version TEXT, user_agent TEXT, payload_size_bytes INTEGER, earliest_pull_at INTEGER, latest_pull_at INTEGER, banners_affected_count INTEGER, error_code TEXT, raw_error_stack TEXT)`
    );

    // Add required indexes
    await sqlite.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS user_game_user_game_uid_idx ON user_game (user_id, game_id, game_uid)`
    );
    await sqlite.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_game_primary ON user_game (user_id, game_id) WHERE is_primary = 1`
    );
    await sqlite.execute(
        `CREATE INDEX IF NOT EXISTS idx_import_log_user ON import_log (user_id, game_id)`
    );
    await sqlite.execute(
        `CREATE INDEX IF NOT EXISTS idx_pull_user_game_date ON pull (user_id, game_id, pulled_at)`
    );
    await sqlite.execute(
        `CREATE INDEX IF NOT EXISTS idx_pull_user_game_uid_date ON pull (user_id, game_id, game_uid, pulled_at)`
    );
    await sqlite.execute(
        `CREATE INDEX IF NOT EXISTS idx_pull_filter_sort ON pull (user_id, game_id, game_uid, banner_type, pulled_at)`
    );
}
