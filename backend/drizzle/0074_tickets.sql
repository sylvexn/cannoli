-- Issue tracker: in-app feedback now becomes a ticket (CAN-<id>) instead of a GitHub issue.
-- id is the ticket number; the GitHub import inserts explicit ids (= issue number), new
-- tickets continue from MAX(id) via AUTOINCREMENT.
CREATE TABLE `tickets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `body` text NOT NULL,
  `type` text DEFAULT 'bug' NOT NULL,
  `status` text DEFAULT 'new' NOT NULL,
  `league_id` text,
  `reporter_user_id` integer,
  `feedback_id` integer,
  `page_url` text,
  `screenshot_path` text,
  `fixed_in` text,
  `github_issue_number` integer,
  `github_url` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  `closed_at` text,
  FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`),
  FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`)
);--> statement-breakpoint
CREATE INDEX `tickets_status_idx` ON `tickets` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_github_unique` ON `tickets` (`github_issue_number`);--> statement-breakpoint
CREATE TABLE `ticket_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ticket_id` integer NOT NULL,
  `actor_user_id` integer,
  `kind` text NOT NULL,
  `from_status` text,
  `to_status` text,
  `text` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`),
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);--> statement-breakpoint
CREATE INDEX `ticket_events_ticket_idx` ON `ticket_events` (`ticket_id`);
