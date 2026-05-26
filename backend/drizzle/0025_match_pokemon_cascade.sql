-- Add ON DELETE CASCADE to match_pokemon.match_id so deleting a match
-- automatically clears its per-Pokemon K/D rows. Previously the FK was
-- "no action", forcing every void/delete handler to manually clear the
-- children first or hit a FK violation under PRAGMA foreign_keys=ON.
--
-- SQLite cannot ALTER a foreign key in place; the standard recipe is:
--   1. create new table with the desired constraint
--   2. INSERT SELECT all rows
--   3. drop old, rename new
-- The PRAGMA toggle below disables FK checks during the swap so the
-- transient state where children point at the old table name doesn't
-- abort the migration.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_match_pokemon` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`match_id` text NOT NULL,
	`team_id` text NOT NULL,
	`pokemon_name` text NOT NULL,
	`kills` integer DEFAULT 0 NOT NULL,
	`deaths` integer DEFAULT 0 NOT NULL,
	`tera_used` integer DEFAULT false NOT NULL,
	`tera_type` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_match_pokemon`(`id`, `match_id`, `team_id`, `pokemon_name`, `kills`, `deaths`, `tera_used`, `tera_type`) SELECT `id`, `match_id`, `team_id`, `pokemon_name`, `kills`, `deaths`, `tera_used`, `tera_type` FROM `match_pokemon`;--> statement-breakpoint
DROP TABLE `match_pokemon`;--> statement-breakpoint
ALTER TABLE `__new_match_pokemon` RENAME TO `match_pokemon`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
