-- Per-match spoiler reveal persistence.
--
-- spoiler_revealed_matches is a JSON array of match IDs the user has
-- individually revealed on schedule/replays surfaces. A revealed match stays
-- revealed for that user across reloads (independent of the per-week
-- spoiler_revealed_through high-water mark).
--   NULL / absent = no matches individually revealed.
ALTER TABLE `user_preferences` ADD COLUMN `spoiler_revealed_matches` TEXT;
