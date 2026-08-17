DROP INDEX `user_game_user_game_idx`;--> statement-breakpoint
ALTER TABLE `user_game` ADD `game_uid` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_game` ADD `nickname` text;--> statement-breakpoint
ALTER TABLE `user_game` ADD `is_primary` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `user_game_user_game_uid_idx` ON `user_game` (`user_id`,`game_id`,`game_uid`);--> statement-breakpoint
CREATE INDEX `idx_user_game_user_game` ON `user_game` (`user_id`,`game_id`);--> statement-breakpoint
DROP INDEX `pull_dedup_idx`;--> statement-breakpoint
CREATE INDEX `idx_pull_user_game_uid` ON `pull` (`user_id`,`game_id`,`game_uid`);--> statement-breakpoint
CREATE UNIQUE INDEX `pull_dedup_idx` ON `pull` (`user_id`,`game_id`,`game_uid`,`pull_id`);
