-- Separate pin provenance from pin recomputability, and make pins league-aware.
--
-- Two long-standing faults are fixed here.
--
-- 1. `awarded_by` was doing double duty: it recorded WHO awarded a pin, and it
--    was also the flag the season-end minters used to decide what they were
--    allowed to delete (`DELETE ... WHERE awarded_by IS NULL`). Those meanings
--    conflict, and both failure modes were live:
--      * An admin override (PATCH /api/admin/pins/:id) never stamped
--        `awarded_by`, so the row stayed NULL and the next mint deleted it and
--        re-derived the ORIGINAL winner — the correction silently reverted.
--      * The archive ceremony and the phase→offseason route DO pass an admin
--        id, so after the first UI-driven finalize the cleanup matched nothing
--        and `INSERT OR IGNORE` skipped — stale winners frozen forever, even
--        though the endpoint advertises re-run-to-recompute.
--    `source` now carries the recompute semantics on its own:
--      'auto'   — owned by the minters; they may delete and re-derive it.
--      'manual' — human-authoritative; minters must never delete it, and must
--                 not mint a competing row for the same (def, season, league).
--    `awarded_by` goes back to being pure provenance.
--
-- 2. `pins` had no `league_id`. Awards are earned per-league but the unique
--    index was (user_id, pin_def_id, season_id), so a coach playing in two
--    leagues in one season could only ever hold one copy of a season pin — the
--    second league's award was dropped by INSERT OR IGNORE with no error. The
--    minters worked around half of this by scoping their DELETE on
--    `metadata.teamId`, which silently does nothing for rows whose metadata
--    only carries `leagueId` (every username-form manual award).
--
-- The replacement unique index uses COALESCE so a NULL season (lifetime pins)
-- and a NULL league (season-wide pins like `ash`/`red`) collapse to a concrete
-- sentinel instead of SQLite's "every NULL is distinct" behaviour. That single
-- index replaces both the old composite and the partial lifetime index from
-- migration 0041. Widening the key can only ever create MORE distinct buckets,
-- so no existing row can violate it.
ALTER TABLE `pins` ADD `source` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `pins` ADD `league_id` text REFERENCES `leagues`(`id`);--> statement-breakpoint
-- Backfill league scope from whichever shape the metadata used. `teamId` is the
-- precise form (set by every auto/archive minter and by pokemon-form manual
-- awards); `leagueId` is the looser form used by username-form manual awards.
UPDATE `pins` SET `league_id` = (
  SELECT `t`.`league_id` FROM `teams` `t`
  WHERE `t`.`id` = json_extract(`pins`.`metadata`, '$.teamId')
) WHERE json_extract(`metadata`, '$.teamId') IS NOT NULL;--> statement-breakpoint
UPDATE `pins` SET `league_id` = json_extract(`metadata`, '$.leagueId')
  WHERE `league_id` IS NULL AND json_extract(`metadata`, '$.leagueId') IS NOT NULL;--> statement-breakpoint
-- Per-match pins (kingslayer/flawless) carry neither shape — their metadata is
-- `{matchId, winnerTeamId, ...}`. Resolve through the match, which is the
-- authoritative league owner, falling back to the winning team.
UPDATE `pins` SET `league_id` = (
  SELECT `m`.`league_id` FROM `matches` `m`
  WHERE `m`.`id` = json_extract(`pins`.`metadata`, '$.matchId')
) WHERE `league_id` IS NULL AND json_extract(`metadata`, '$.matchId') IS NOT NULL;--> statement-breakpoint
UPDATE `pins` SET `league_id` = (
  SELECT `t`.`league_id` FROM `teams` `t`
  WHERE `t`.`id` = json_extract(`pins`.`metadata`, '$.winnerTeamId')
) WHERE `league_id` IS NULL AND json_extract(`metadata`, '$.winnerTeamId') IS NOT NULL;--> statement-breakpoint
-- Every pin against a hand-curated (is_auto=0) definition is human-authoritative,
-- regardless of whether it was typed in the admin UI or bulk-minted from the
-- awards-data.ts lists. Those must survive an auto re-run untouched.
UPDATE `pins` SET `source` = 'manual'
  WHERE `pin_def_id` IN (SELECT `id` FROM `pin_definitions` WHERE `is_auto` = 0);--> statement-breakpoint
-- S9/S10 additionally have hand-curated winners for THREE is_auto=1 slugs.
-- awards-data.ts is explicit that its rows are the source of truth for
-- garchomp / cannoli / cynthia and deliberately override the auto minter — the
-- Discord-announced winners were tallied by a human from data we no longer hold
-- (those seasons were imported without per-Pokemon match rows, so the minter
-- reports 'no-eligible-matches' and would re-derive nothing).
--
-- Marking them 'auto' would let a forced re-run DELETE verified history and
-- replace it with nothing, or with a different winner. Verified against a live
-- snapshot: it wiped all 3 S9 garchomp pins and re-pointed S9 Ruby's cannoli at
-- a different coach.
--
-- Scoped by slug rather than by season-archived, because the four archive pins
-- (champion/high-score/steal-of-the-draft/sweeper) and the two per-match pins
-- ARE genuinely auto-derived even in these seasons, and must stay recomputable
-- so the one-winner-per-league tiebreak can collapse S10's 14 High Score
-- holders down to 3.
UPDATE `pins` SET `source` = 'manual'
  WHERE `season_id` IN (SELECT `id` FROM `seasons` WHERE `season_number` IN (9, 10))
    AND `pin_def_id` NOT IN (
      'champion', 'high-score', 'steal-of-the-draft', 'sweeper', 'kingslayer', 'flawless'
    );--> statement-breakpoint
DROP INDEX IF EXISTS `pins_user_def_season_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `pins_user_def_lifetime_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `pins_identity_idx` ON `pins` (
  `user_id`, `pin_def_id`, COALESCE(`season_id`, -1), COALESCE(`league_id`, '')
);--> statement-breakpoint
-- Season-scoped reads (archive awards page) previously full-scanned: season_id
-- was only the trailing column of the old composite index.
CREATE INDEX `pins_season_idx` ON `pins` (`season_id`);
