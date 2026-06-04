PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`pity_display_mode` text DEFAULT 'count_up' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "theme_check" CHECK("__new_user_settings"."theme" IN ('system', 'quantum-dark', 'amber-dawn', 'wobbly-waves')),
	CONSTRAINT "pity_display_mode_check" CHECK("__new_user_settings"."pity_display_mode" IN ('count_up', 'count_down'))
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("user_id", "theme", "pity_display_mode", "updated_at") SELECT "user_id", "theme", "pity_display_mode", "updated_at" FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;