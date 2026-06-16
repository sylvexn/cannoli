-- OBSERVABILITY OVERHAUL: error grouping, distinct-user tracking, health checks,
-- plus request_logs enrichment (fingerprint / request id / context / breadcrumbs).
--
-- request_logs rows link to an error_groups row via `fingerprint`. The groups
-- table never prunes (request_logs does, at ~5000 rows), so per-bug counts and
-- first-seen survive. Powers the dev Observability dashboard + Discord alerts.

ALTER TABLE `request_logs` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `context` text;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `breadcrumbs` text;--> statement-breakpoint
CREATE INDEX `request_logs_fingerprint_idx` ON `request_logs` (`fingerprint`);--> statement-breakpoint

CREATE TABLE `error_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`kind` text DEFAULT 'server' NOT NULL,
	`error_name` text,
	`sample_message` text,
	`sample_path` text,
	`sample_stack` text,
	`count` integer DEFAULT 0 NOT NULL,
	`affected_users` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`first_seen` text DEFAULT (datetime('now')),
	`last_seen` text DEFAULT (datetime('now')),
	`first_version` text,
	`last_version` text,
	`resolved_at` text,
	`resolved_version` text,
	`notified_at` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `error_groups_fingerprint_idx` ON `error_groups` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `error_groups_status_idx` ON `error_groups` (`status`);--> statement-breakpoint
CREATE INDEX `error_groups_last_seen_idx` ON `error_groups` (`last_seen`);--> statement-breakpoint

CREATE TABLE `error_group_users` (
	`fingerprint` text NOT NULL,
	`user_id` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `error_group_users_pk` ON `error_group_users` (`fingerprint`,`user_id`);--> statement-breakpoint

CREATE TABLE `health_checks` (
	`name` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`latency_ms` integer,
	`checked_at` text,
	`last_ok_at` text
);
