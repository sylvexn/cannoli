CREATE TABLE `draft_state` (
	`league_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`current_pick_index` integer DEFAULT 0 NOT NULL,
	`timer_duration` integer DEFAULT 120 NOT NULL,
	`timer_started_at` text,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action
);
