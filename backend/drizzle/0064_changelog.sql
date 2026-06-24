-- DB-backed "What's New" changelog feed (replaces the image-baked
-- src/content/changelog.json as the runtime source). Entries are published via
-- the admin API; existing history is backfilled from the JSON at boot when this
-- table is empty (see ensureChangelogSeeded in src/routes/changelog.ts).
CREATE TABLE `changelog` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `changelog_date_idx` ON `changelog` (`date`);
