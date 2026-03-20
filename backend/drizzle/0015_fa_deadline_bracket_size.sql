ALTER TABLE `site_settings` ADD `fa_deadline_week` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE `site_settings` ADD `default_playoff_team_count` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `playoff_team_count` integer DEFAULT 6 NOT NULL;
