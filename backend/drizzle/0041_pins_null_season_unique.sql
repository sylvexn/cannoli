-- PIN-NULL-DUP: the composite unique index pins_user_def_season_idx
-- (user_id, pin_def_id, season_id) does NOT prevent duplicate lifetime pins,
-- because SQLite treats every NULL as distinct in a UNIQUE index — so two rows
-- (user, def, NULL) never collide. Lifetime / season-agnostic pins (and the
-- auto-award job's NULL-season pins) could therefore be awarded repeatedly.
--
-- Fix: a PARTIAL unique index over just (user_id, pin_def_id) WHERE the season
-- is NULL. This makes INSERT OR IGNORE correctly no-op the second lifetime
-- award (and lets the award handler return 409 on changes=0), while leaving the
-- season-scoped uniqueness handled by the existing full composite index.
--
-- De-dupe any pre-existing duplicate lifetime rows first (keep the lowest id)
-- so the unique index can be created.
DELETE FROM `pins`
WHERE `season_id` IS NULL
  AND `id` NOT IN (
    SELECT MIN(`id`) FROM `pins`
    WHERE `season_id` IS NULL
    GROUP BY `user_id`, `pin_def_id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `pins_user_def_lifetime_idx`
  ON `pins` (`user_id`, `pin_def_id`)
  WHERE `season_id` IS NULL;
