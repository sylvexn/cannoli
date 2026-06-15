-- API-OBSERVABILITY: raw per-request audit trail powering the admin "API Logs"
-- tab. Written by the logging middleware in src/index.ts (onAfterResponse /
-- onError); pruned opportunistically on insert so it never grows unbounded.
-- Distinct from activity_log (business events) — this is HTTP traffic + errors.
CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`user_id` integer,
	`username` text,
	`ip` text,
	`error_name` text,
	`error_message` text,
	`error_stack` text,
	`timestamp` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
-- Newest-first scans + status-class filtering are the hot read paths.
CREATE INDEX `request_logs_ts_idx` ON `request_logs` (`timestamp`);
--> statement-breakpoint
CREATE INDEX `request_logs_status_idx` ON `request_logs` (`status`);
