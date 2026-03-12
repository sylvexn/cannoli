CREATE TABLE `player_availability` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`day` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`note` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action
);
