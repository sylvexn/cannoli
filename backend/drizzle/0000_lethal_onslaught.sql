CREATE TABLE `draft_picks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`team_id` text NOT NULL,
	`pick_number` integer NOT NULL,
	`pokemon_name` text NOT NULL,
	`tier` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leagues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`season_id` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `match_pokemon` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`pokemon_name` text NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`tera_used` integer DEFAULT false NOT NULL,
	`tera_type` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`home_team_id` text NOT NULL,
	`away_team_id` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`replay_url` text,
	`phase` text DEFAULT 'regular' NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pokemon` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type1` text NOT NULL,
	`type2` text,
	`hp` integer NOT NULL,
	`atk` integer NOT NULL,
	`def` integer NOT NULL,
	`spa` integer NOT NULL,
	`spd` integer NOT NULL,
	`spe` integer NOT NULL,
	`ability1` text,
	`ability2` text,
	`hidden_ability` text,
	`tier` integer DEFAULT 0 NOT NULL,
	`tera_banned` integer DEFAULT false NOT NULL,
	`banned` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokemon_name_unique` ON `pokemon` (`name`);--> statement-breakpoint
CREATE TABLE `rosters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`team_id` text NOT NULL,
	`pokemon_name` text NOT NULL,
	`tier` integer NOT NULL,
	`is_tera_captain` integer DEFAULT false NOT NULL,
	`tera_type1` text,
	`tera_type2` text,
	`tera_type3` text,
	`is_shiny` integer DEFAULT false NOT NULL,
	`acquired_via` text DEFAULT 'draft' NOT NULL,
	`acquired_week` integer,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_number` integer NOT NULL,
	`phase` text NOT NULL,
	`current_week` integer DEFAULT 0 NOT NULL,
	`total_weeks` integer DEFAULT 11 NOT NULL,
	`point_cap` integer DEFAULT 110 NOT NULL,
	`tera_captain_slots` integer DEFAULT 2 NOT NULL,
	`trade_deadline_week` integer DEFAULT 7 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`coach_name` text NOT NULL,
	`team_name` text NOT NULL,
	`team_abbrev` text NOT NULL,
	`team_color` text DEFAULT '#888888' NOT NULL,
	`showdown_username` text,
	`rank` integer,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`type` text NOT NULL,
	`team_id` text NOT NULL,
	`other_team_id` text,
	`pokemon_out` text,
	`points_out` integer,
	`pokemon_in` text,
	`points_in` integer,
	`tera_pokemon` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`other_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
