CREATE TABLE `draft_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`position` integer NOT NULL,
	`pokemon_name` text NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
