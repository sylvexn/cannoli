-- FEEDBACK REWORK: real feedback table storing every submission across all 4
-- categories (bug | feature | league | general). bug/feature also mirror to a
-- GitHub issue (github_issue_* set); league/general are in-app only. Admin
-- triage reads from here; resolve emits a reporter notification.
--
-- feedback_submissions is intentionally NOT dropped here — it still powers the
-- legacy GitHub-close polling toast until the notifications system retires it.

CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`page` text,
	`error_ref` text,
	`screenshot_path` text,
	`github_issue_number` integer,
	`github_issue_url` text,
	`status` text DEFAULT 'open' NOT NULL,
	`admin_response` text,
	`resolved_by_user_id` integer,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`);
--> statement-breakpoint
CREATE INDEX `feedback_category_idx` ON `feedback` (`category`);
--> statement-breakpoint
CREATE INDEX `feedback_user_idx` ON `feedback` (`user_id`);
