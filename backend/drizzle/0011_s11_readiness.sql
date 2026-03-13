ALTER TABLE `matches` ADD `deadline` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `forfeited_by` text;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `national_dex_number` integer;--> statement-breakpoint
ALTER TABLE `pokemon` ADD `form_category` text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE `seasons` ADD `paused` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `seasons` ADD `forfeit_policy` text DEFAULT 'double_forfeit' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `logo_path` text;--> statement-breakpoint
ALTER TABLE `users` ADD `primary_color` text;--> statement-breakpoint
ALTER TABLE `users` ADD `secondary_color` text;--> statement-breakpoint
ALTER TABLE `users` ADD `tertiary_color` text;