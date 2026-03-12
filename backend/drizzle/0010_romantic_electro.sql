CREATE TABLE `feedback_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`issue_number` integer NOT NULL,
	`issue_url` text NOT NULL,
	`title` text NOT NULL,
	`acknowledged_at` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
