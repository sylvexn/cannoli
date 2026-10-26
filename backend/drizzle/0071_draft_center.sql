-- Draft Center: per-user mock-up teams (planner for drafts + trade ideas).
-- `roster` is a JSON array of picks (name, captain flag, tera types, optional
-- set); `league_id` names the league whose ruleset the team is checked against.
-- A non-null `share_token` makes the team readable (read-only) at an
-- unguessable public link; clearing it revokes the link.
CREATE TABLE `draft_center_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`league_id` text,
	`roster` text DEFAULT '[]' NOT NULL,
	`share_token` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `draft_center_teams_user_idx` ON `draft_center_teams` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_center_teams_share_uq` ON `draft_center_teams` (`share_token`);
