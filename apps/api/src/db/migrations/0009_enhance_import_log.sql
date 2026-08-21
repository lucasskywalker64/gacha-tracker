PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_import_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_id` text,
	`game_uid` text,
	`initiated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`status` text NOT NULL,
	`total_fetched` integer,
	`new_pulls` integer,
	`duplicates` integer,
	`error_message` text,
	`source_ip` text,
	`script_duration_ms` integer,
	`pity_calc_duration_ms` integer,
	`db_write_duration_ms` integer,
	`backend_duration_ms` integer,
	`queue_wait_duration_ms` integer,
	`total_duration_ms` integer,
	`import_method` text,
	`script_version` text,
	`web_app_version` text,
	`file_version` text,
	`user_agent` text,
	`payload_size_bytes` integer,
	`earliest_pull_at` integer,
	`latest_pull_at` integer,
	`banners_affected_count` integer,
	`error_code` text,
	`raw_error_stack` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action
);
INSERT INTO `__new_import_log`("id", "user_id", "game_id", "game_uid", "initiated_at", "completed_at", "status", "total_fetched", "new_pulls", "duplicates", "error_message", "source_ip") SELECT "id", "user_id", "game_id", "game_uid", "initiated_at", "completed_at", "status", "total_fetched", "new_pulls", "duplicates", "error_message", "source_ip" FROM `import_log`;--> statement-breakpoint
DROP TABLE `import_log`;--> statement-breakpoint
ALTER TABLE `__new_import_log` RENAME TO `import_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_import_log_user` ON `import_log` (`user_id`,`game_id`);