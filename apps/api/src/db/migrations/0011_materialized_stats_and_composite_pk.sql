DROP TABLE `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pull` (
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
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `game_id`, `game_uid`, `pull_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pull`("user_id", "game_id", "game_uid", "pull_id", "banner_type", "banner_id", "item_id", "item_name", "item_type", "rarity", "pulled_at", "pity_at_pull", "was_guaranteed", "pity_version", "created_at") SELECT "user_id", "game_id", "game_uid", "pull_id", "banner_type", "banner_id", "item_id", "item_name", "item_type", "rarity", "pulled_at", "pity_at_pull", "was_guaranteed", "pity_version", "created_at" FROM `pull`;--> statement-breakpoint
DROP TABLE `pull`;--> statement-breakpoint
ALTER TABLE `__new_pull` RENAME TO `pull`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_pull_user_game_date` ON `pull` (`user_id`,`game_id`,`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_pull_user_game_uid_date` ON `pull` (`user_id`,`game_id`,`game_uid`,`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_pull_filter_sort` ON `pull` (`user_id`,`game_id`,`game_uid`,`banner_type`,`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_pull_game_banner` ON `pull` (`game_id`,`banner_type`);--> statement-breakpoint
CREATE INDEX `idx_pull_pulled_at` ON `pull` (`pulled_at`);--> statement-breakpoint
CREATE INDEX `idx_pull_rarity` ON `pull` (`rarity`);--> statement-breakpoint
DROP INDEX `idx_user_game_user`;--> statement-breakpoint
DROP INDEX `idx_user_game_user_game`;--> statement-breakpoint
ALTER TABLE `user_game` ADD `stats_total_pulls` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_game` ADD `stats_four_stars` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_game` ADD `stats_five_stars` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_game` ADD `stats_current_pity` text;--> statement-breakpoint
ALTER TABLE `user_game` ADD `stats_five_star_history` text;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`code_hash` text,
	`is_anonymous` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer,
	`theme` text DEFAULT 'system' NOT NULL,
	`pity_display_mode` text DEFAULT 'count_up' NOT NULL,
	CONSTRAINT "user_theme_check" CHECK("__new_user"."theme" IN ('system', 'quantum-dark', 'amber-dawn', 'wobbly-waves')),
	CONSTRAINT "user_pity_display_mode_check" CHECK("__new_user"."pity_display_mode" IN ('count_up', 'count_down'))
);
--> statement-breakpoint
INSERT INTO `__new_user`("id", "name", "email", "email_verified", "image", "created_at", "updated_at", "code_hash", "is_anonymous", "role", "banned", "ban_reason", "ban_expires", "theme", "pity_display_mode") SELECT "id", "name", "email", "email_verified", "image", "created_at", "updated_at", "code_hash", "is_anonymous", "role", "banned", "ban_reason", "ban_expires", 'system', 'count_up' FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `account_provider_account_idx` ON `account` (`provider_id`,`account_id`);
