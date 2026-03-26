-- Move per-league lifecycle fields from `seasons` → `leagues`.
--
-- Cannoli runs 3 concurrent leagues per season. The fields below are league-
-- scoped in practice but lived on the season row, so advancing one league's
-- phase or generating its schedule clobbered the others. This migration
-- relocates them and backfills from the (single, shared) season values that
-- were in use before the split.
--
-- Notes:
--   * SQLite supports `ALTER TABLE ... DROP COLUMN` since 3.35 (Bun's bundled
--     SQLite is well past that), so we can drop without table-recreation.
--   * `pointCap`, `teraCaptainSlots`, `scheduleType` stay on `seasons` —
--     they are intentional season-wide settings.

-- 1) Add the new league columns. Defaults match the previous season defaults
--    so any league that doesn't get a backfill (shouldn't happen, but defense)
--    lands in a sane spot.
ALTER TABLE `leagues` ADD `phase` text DEFAULT 'predraft' NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `current_week` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `total_weeks` integer DEFAULT 11 NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `week_dates` text;--> statement-breakpoint
ALTER TABLE `leagues` ADD `paused` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `forfeit_policy` text DEFAULT 'double_forfeit' NOT NULL;--> statement-breakpoint
ALTER TABLE `leagues` ADD `trade_deadline_week` integer DEFAULT 7 NOT NULL;--> statement-breakpoint

-- 2) Backfill each league row from its parent season.
UPDATE `leagues` SET
  `phase` = COALESCE((SELECT `phase` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 'predraft'),
  `current_week` = COALESCE((SELECT `current_week` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 0),
  `total_weeks` = COALESCE((SELECT `total_weeks` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 11),
  `week_dates` = (SELECT `week_dates` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`),
  `paused` = COALESCE((SELECT `paused` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 0),
  `forfeit_policy` = COALESCE((SELECT `forfeit_policy` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 'double_forfeit'),
  `trade_deadline_week` = COALESCE((SELECT `trade_deadline_week` FROM `seasons` WHERE `seasons`.`id` = `leagues`.`season_id`), 7);
--> statement-breakpoint

-- 3) Drop the moved columns from `seasons`.
ALTER TABLE `seasons` DROP COLUMN `phase`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `current_week`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `total_weeks`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `week_dates`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `paused`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `forfeit_policy`;--> statement-breakpoint
ALTER TABLE `seasons` DROP COLUMN `trade_deadline_week`;
