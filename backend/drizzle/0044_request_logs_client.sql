-- API-OBSERVABILITY: extend request_logs to also hold browser-side faults.
-- `source` distinguishes server HTTP traffic from client errors posted to
-- /api/client-errors (window.onerror, unhandledrejection, React error
-- boundary). `error_id` is a short correlation ref shown to the user and
-- embedded in their feedback issue so a report ties back to a specific row.
ALTER TABLE `request_logs` ADD `source` text DEFAULT 'server' NOT NULL;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD `error_id` text;
--> statement-breakpoint
-- Client-vs-server split is a common filter in the API Logs tab.
CREATE INDEX `request_logs_source_idx` ON `request_logs` (`source`);
