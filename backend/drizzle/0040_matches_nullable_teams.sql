-- PLAYOFF-TBD-FK: make matches.home_team_id / away_team_id NULLABLE so
-- not-yet-determined playoff bracket slots can be stored as NULL instead of the
-- 'TBD' sentinel (which violated the FK onto teams.id under PRAGMA
-- foreign_keys=ON and crashed every 4/6/8-team bracket in live mode).
--
-- SQLite cannot drop a NOT NULL constraint in place, so we do the standard
-- table rebuild: create new with the relaxed constraint, copy, drop, rename.
-- The FKs (league_id, home_team_id, away_team_id, winner_team_id) and column
-- set are preserved exactly. There are no indexes on `matches`.
--
-- Pre-existing 'TBD' rows (e.g. sim-seeded brackets) are normalized to NULL so
-- the FK is satisfiable after the rebuild.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `matches_new` (
	`id` text PRIMARY KEY NOT NULL,
	`league_id` text NOT NULL,
	`week` integer NOT NULL,
	`home_team_id` text,
	`away_team_id` text,
	`home_score` integer,
	`away_score` integer,
	`replay_url` text,
	`phase` text DEFAULT 'regular' NOT NULL,
	`playoff_round` text,
	`home_seed` integer,
	`away_seed` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`ready_home` integer DEFAULT false NOT NULL,
	`ready_away` integer DEFAULT false NOT NULL,
	`started_at` text,
	`completed_at` text,
	`ps_room_id` text,
	`replay_log` text,
	`warnings` text,
	`deadline` text,
	`forfeited_by` text,
	`winner_team_id` text REFERENCES teams(id),
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `matches_new` (
	`id`, `league_id`, `week`, `home_team_id`, `away_team_id`, `home_score`,
	`away_score`, `replay_url`, `phase`, `playoff_round`, `home_seed`,
	`away_seed`, `status`, `ready_home`, `ready_away`, `started_at`,
	`completed_at`, `ps_room_id`, `replay_log`, `warnings`, `deadline`,
	`forfeited_by`, `winner_team_id`
)
SELECT
	`id`, `league_id`, `week`,
	NULLIF(`home_team_id`, 'TBD'),
	NULLIF(`away_team_id`, 'TBD'),
	`home_score`, `away_score`, `replay_url`, `phase`, `playoff_round`,
	`home_seed`, `away_seed`, `status`, `ready_home`, `ready_away`,
	`started_at`, `completed_at`, `ps_room_id`, `replay_log`, `warnings`,
	`deadline`, `forfeited_by`,
	NULLIF(`winner_team_id`, 'TBD')
FROM `matches`;
--> statement-breakpoint
DROP TABLE `matches`;
--> statement-breakpoint
ALTER TABLE `matches_new` RENAME TO `matches`;
--> statement-breakpoint
PRAGMA foreign_keys = ON;
