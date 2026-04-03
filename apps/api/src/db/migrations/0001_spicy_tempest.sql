CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`admin_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_id` text NOT NULL,
	`game_uid` text NOT NULL,
	`initiated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_fetched` integer,
	`new_pulls` integer,
	`duplicates` integer,
	`error_message` text,
	`source_ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_import_logs_user` ON `import_logs` (`user_id`,`game_id`);--> statement-breakpoint
CREATE TABLE `pulls` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_id` text NOT NULL,
	`game_uid` text NOT NULL,
	`pull_id` text NOT NULL,
	`banner_type` text NOT NULL,
	`banner_id` text,
	`item_id` text NOT NULL,
	`item_name` text NOT NULL,
	`item_type` text NOT NULL,
	`rarity` integer NOT NULL,
	`pulled_at` integer NOT NULL,
	`pity_at_pull` integer NOT NULL,
	`was_guaranteed` integer NOT NULL,
	`pity_version` integer DEFAULT 1 NOT NULL,
	`extra` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pulls_dedup_idx` ON `pulls` (`user_id`,`game_id`,`pull_id`);--> statement-breakpoint
CREATE INDEX `idx_pulls_user_game` ON `pulls` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `idx_pulls_game_banner` ON `pulls` (`game_id`,`banner_type`);--> statement-breakpoint
CREATE INDEX `idx_pulls_pulled_at` ON `pulls` (`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_pulls_rarity` ON `pulls` (`rarity`);--> statement-breakpoint
CREATE TABLE `user_games` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`game_id` text NOT NULL,
	`last_import` integer,
	`latest_pull_ids` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_games_user_game_idx` ON `user_games` (`user_id`,`game_id`);--> statement-breakpoint
CREATE INDEX `idx_user_games_user` ON `user_games` (`user_id`);