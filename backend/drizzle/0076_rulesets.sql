-- Rulesets: one named, versioned rules object a league points at (see plan/ruleset-design.md).
-- Purely additive: new table + two NULLABLE pointer columns. Nothing reads them yet, so
-- archived S9/S10/S11 behaviour is untouched. Rows are created by scripts/backfill-rulesets.ts.
CREATE TABLE `rulesets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_template` integer DEFAULT 0 NOT NULL,
	`source_ruleset_id` integer,
	`cost_format` text NOT NULL,
	`point_cap` integer DEFAULT 110 NOT NULL,
	`roster_size` integer DEFAULT 10 NOT NULL,
	`roster_min` integer,
	`roster_max` integer,
	`mega_cap` integer DEFAULT 1,
	`tera_enabled` integer DEFAULT 1 NOT NULL,
	`tera_captain_slots` integer DEFAULT 2 NOT NULL,
	`tera_types_per_captain` integer DEFAULT 3 NOT NULL,
	`tera_markup` text NOT NULL,
	`policy` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	`created_by` integer,
	FOREIGN KEY (`source_ruleset_id`) REFERENCES `rulesets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rulesets_template_idx` ON `rulesets` (`is_template`);
--> statement-breakpoint
ALTER TABLE `leagues` ADD `ruleset_id` integer REFERENCES `rulesets`(`id`);
--> statement-breakpoint
ALTER TABLE `draft_center_teams` ADD `ruleset_id` integer REFERENCES `rulesets`(`id`);
