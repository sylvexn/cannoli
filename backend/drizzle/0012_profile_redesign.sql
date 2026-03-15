CREATE TABLE `user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`density` text DEFAULT 'comfortable' NOT NULL,
	`default_landing_path` text DEFAULT '/' NOT NULL,
	`notify_trades` integer DEFAULT true NOT NULL,
	`notify_matches` integer DEFAULT true NOT NULL,
	`notify_announcements` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `teams` ADD `banner_path` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `display_name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_path` text;