-- Performance indexes for core transactional tables.
-- These tables had zero indexes; this migration adds the most impactful
-- access-pattern indexes plus unique constraints on rosters and draft_picks.

CREATE INDEX IF NOT EXISTS `matches_league_week_idx` ON `matches` (`league_id`, `week`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `matches_status_idx` ON `matches` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rosters_team_idx` ON `rosters` (`team_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_pokemon_match_idx` ON `match_pokemon` (`match_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_league_week_idx` ON `transactions` (`league_id`, `week`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `draft_picks_league_team_idx` ON `draft_picks` (`league_id`, `team_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `teams_league_idx` ON `teams` (`league_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bye_weeks_team_idx` ON `bye_weeks` (`team_id`);
--> statement-breakpoint
-- Dedupe rosters before adding unique constraint (keep lowest id per team/pokemon).
DELETE FROM `rosters`
WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `rosters`
  GROUP BY `team_id`, `pokemon_name`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rosters_team_pokemon_unique` ON `rosters` (`team_id`, `pokemon_name`);
--> statement-breakpoint
-- Dedupe draft_picks by (league_id, pokemon_name) before unique constraint.
DELETE FROM `draft_picks`
WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `draft_picks`
  GROUP BY `league_id`, `pokemon_name`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `draft_picks_league_pokemon_unique` ON `draft_picks` (`league_id`, `pokemon_name`);
--> statement-breakpoint
-- Dedupe draft_picks by (league_id, pick_number) before unique constraint.
DELETE FROM `draft_picks`
WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `draft_picks`
  GROUP BY `league_id`, `pick_number`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `draft_picks_league_picknum_unique` ON `draft_picks` (`league_id`, `pick_number`);
