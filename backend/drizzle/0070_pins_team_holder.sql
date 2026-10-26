-- Badge rework: admin-curated awards, team as the holder.
--
-- pin_definitions gains
--   scope           'league' (one winner set per league-season) | 'season'
--                   (one across the whole season) | 'team' (one per team per
--                   league-season, e.g. MVP) | 'match' (one per qualifying match)
--   metadata_fields JSON array of the inputs an award of this pin collects
--                   ('pokemon', 'nickname', 'match', 'note'). Replaces the
--                   hardcoded frontend map.
--
-- pins is rebuilt (SQLite cannot drop NOT NULL) to add
--   team_id    the holder; the user is derived at read time via teams.user_id
--   match_id   identity for per-match awards (kingslayer / flawless)
--   published  0 = staff-only draft, 1 = public. Existing rows are public.
-- and to make user_id nullable (legacy / unlinked-team awards).
-- Identity is now team + def + season + league + match, so a team can hold
-- several per-match pins and an unlinked team can hold awards at all.
ALTER TABLE `pin_definitions` ADD `scope` text DEFAULT 'league' NOT NULL;--> statement-breakpoint
ALTER TABLE `pin_definitions` ADD `metadata_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `pin_definitions` SET `scope` = 'match' WHERE `id` IN ('kingslayer', 'flawless');--> statement-breakpoint
UPDATE `pin_definitions` SET `scope` = 'season' WHERE `id` IN ('ash', 'red');--> statement-breakpoint
UPDATE `pin_definitions` SET `metadata_fields` = '["pokemon","nickname"]' WHERE `id` = 'rotom';--> statement-breakpoint
UPDATE `pin_definitions` SET `metadata_fields` = '["pokemon"]'
  WHERE `id` IN ('dragapult', 'florges', 'charizard', 'pikachu', 'baxcalibur', 'kingambit',
                 'clodsire', 'garchomp', 'high-score', 'steal-of-the-draft');--> statement-breakpoint
UPDATE `pin_definitions` SET `metadata_fields` = '["match"]' WHERE `id` IN ('kingslayer', 'flawless');--> statement-breakpoint
INSERT OR IGNORE INTO `pin_definitions`
  (`id`, `name`, `description`, `icon_name`, `color`, `category`, `is_auto`, `scope`, `metadata_fields`)
VALUES ('team-mvp', 'Team MVP', 'Most valuable Pokemon on a team', 'Star', '#38bdf8', 'season', 0, 'team', '["pokemon"]');--> statement-breakpoint
CREATE TABLE `pins_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer REFERENCES `users`(`id`) ON DELETE cascade,
  `team_id` text REFERENCES `teams`(`id`) ON DELETE cascade,
  `pin_def_id` text NOT NULL REFERENCES `pin_definitions`(`id`) ON DELETE cascade,
  `season_id` integer REFERENCES `seasons`(`id`),
  `league_id` text REFERENCES `leagues`(`id`) ON DELETE cascade,
  `match_id` text,
  `awarded_at` text DEFAULT (datetime('now')),
  `awarded_by` integer REFERENCES `users`(`id`),
  `source` text DEFAULT 'auto' NOT NULL,
  `published` integer DEFAULT 1 NOT NULL,
  `metadata` text
);--> statement-breakpoint
INSERT INTO `pins_new`
  (`id`, `user_id`, `team_id`, `pin_def_id`, `season_id`, `league_id`, `match_id`,
   `awarded_at`, `awarded_by`, `source`, `published`, `metadata`)
SELECT
  `p`.`id`, `p`.`user_id`,
  COALESCE(
    (SELECT `t`.`id` FROM `teams` `t` WHERE `t`.`id` = json_extract(`p`.`metadata`, '$.teamId')),
    (SELECT `t`.`id` FROM `teams` `t` WHERE `t`.`id` = json_extract(`p`.`metadata`, '$.winnerTeamId')),
    (SELECT `t`.`id` FROM `teams` `t` WHERE `t`.`user_id` = `p`.`user_id`
       AND `t`.`league_id` = `p`.`league_id` LIMIT 1)
  ),
  `p`.`pin_def_id`, `p`.`season_id`, `p`.`league_id`,
  json_extract(`p`.`metadata`, '$.matchId'),
  `p`.`awarded_at`, `p`.`awarded_by`, `p`.`source`, 1, `p`.`metadata`
FROM `pins` `p`;--> statement-breakpoint
DROP TABLE `pins`;--> statement-breakpoint
ALTER TABLE `pins_new` RENAME TO `pins`;--> statement-breakpoint
CREATE UNIQUE INDEX `pins_identity_idx` ON `pins` (
  COALESCE(`team_id`, 'u' || COALESCE(`user_id`, '')), `pin_def_id`,
  COALESCE(`season_id`, -1), COALESCE(`league_id`, ''), COALESCE(`match_id`, '')
);--> statement-breakpoint
CREATE INDEX `pins_season_idx` ON `pins` (`season_id`);--> statement-breakpoint
CREATE INDEX `pins_team_idx` ON `pins` (`team_id`);--> statement-breakpoint
CREATE INDEX `pins_user_idx` ON `pins` (`user_id`);
