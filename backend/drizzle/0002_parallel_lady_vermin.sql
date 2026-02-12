CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`actor` text NOT NULL,
	`league_id` text,
	`description` text NOT NULL,
	`metadata` text,
	`timestamp` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`site_name` text DEFAULT 'Cannoli',
	`announcement` text,
	`announcement_type` text DEFAULT 'info',
	`default_point_cap` integer DEFAULT 110,
	`default_tera_captain_slots` integer DEFAULT 2,
	`default_trade_deadline_week` integer DEFAULT 7,
	`default_roster_size` integer DEFAULT 10,
	`default_max_teams` integer DEFAULT 12
);
--> statement-breakpoint
CREATE TABLE `trade_block_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`pokemon_name` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`proposer_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`offering` text NOT NULL,
	`requesting` text NOT NULL,
	`proposed_at` text DEFAULT (datetime('now')),
	`resolved_at` text,
	`resolved_by` text,
	`reject_reason` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposer_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `seasons` ADD `schedule_type` text DEFAULT 'round_robin';