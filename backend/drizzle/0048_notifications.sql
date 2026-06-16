-- NOTIFICATIONS: directed per-recipient events (notifications) + site-wide
-- broadcasts (announcements) + a per-user announcements seen-stamp mirroring
-- changelog_seen_at. Powers the unified notifications pane. The announcements
-- table is distinct from site_settings.announcement (the home-page banner).

CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`metadata` text,
	`dedupe_key` text,
	`created_at` text DEFAULT (datetime('now')),
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`category` text DEFAULT 'info' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now')),
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `user_preferences` ADD `announcements_seen_at` text;
