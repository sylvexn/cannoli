-- First-party usage analytics. usage_events holds raw beacon rows (~90 day
-- retention via opportunistic prune in lib/usage.ts); usage_daily +
-- usage_daily_totals are the per-completed-UTC-day rollups that preserve
-- history beyond the raw window (written by the usage-rollup scheduler job).
CREATE TABLE `usage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text DEFAULT (datetime('now')),
	`event` text DEFAULT 'pageview' NOT NULL,
	`route` text NOT NULL,
	`path` text NOT NULL,
	`user_id` integer,
	`anon_id` text,
	`device` text NOT NULL,
	`referrer` text
);
--> statement-breakpoint
CREATE INDEX `usage_events_ts_idx` ON `usage_events` (`ts`);
--> statement-breakpoint
CREATE INDEX `usage_events_event_ts_idx` ON `usage_events` (`event`,`ts`);
--> statement-breakpoint
CREATE INDEX `usage_events_user_ts_idx` ON `usage_events` (`user_id`,`ts`);
--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`event` text NOT NULL,
	`route` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`unique_users` integer DEFAULT 0 NOT NULL,
	`unique_anons` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `event`, `route`)
);
--> statement-breakpoint
CREATE TABLE `usage_daily_totals` (
	`date` text PRIMARY KEY NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`unique_users` integer DEFAULT 0 NOT NULL,
	`unique_anons` integer DEFAULT 0 NOT NULL
);
