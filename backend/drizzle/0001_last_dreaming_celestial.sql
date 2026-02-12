CREATE TABLE `move_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `move_category_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`move_id` text NOT NULL,
	`is_ability` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `move_categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `leagues` ADD `draft_order` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `playoff_round` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `home_seed` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `away_seed` integer;--> statement-breakpoint
ALTER TABLE `teams` ADD `user_id` integer;