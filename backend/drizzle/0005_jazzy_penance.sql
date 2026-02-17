CREATE TABLE `match_ready_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`event` text NOT NULL,
	`timestamp` text DEFAULT (datetime('now')),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scrim_pokemon` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scrim_id` integer NOT NULL,
	`team_id` text NOT NULL,
	`pokemon_name` text NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`tera_used` integer DEFAULT false NOT NULL,
	`tera_type` text,
	FOREIGN KEY (`scrim_id`) REFERENCES `scrims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scrims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`replay_url` text,
	`ps_room_id` text,
	`played_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `matches` ADD `status` text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `ready_home` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `ready_away` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `started_at` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `ps_room_id` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `replay_log` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `warnings` text;