-- Free-agency approval queue. Non-staff FA pickups land here as `pending`
-- instead of mutating rosters immediately; an admin approves (applies) or
-- rejects them (feedback #42). pickups/drops are JSON-encoded name arrays.
CREATE TABLE `fa_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`team_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pickups` text NOT NULL,
	`drops` text NOT NULL,
	`requested_by` text,
	`requested_at` text DEFAULT (datetime('now')),
	`resolved_by` text,
	`resolved_at` text,
	`reject_reason` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fa_requests_league_week_idx` ON `fa_requests` (`league_id`,`week`);
--> statement-breakpoint
CREATE INDEX `fa_requests_status_idx` ON `fa_requests` (`status`);
