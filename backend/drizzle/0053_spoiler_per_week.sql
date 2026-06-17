-- Per-week spoiler reveals + spoiler-free ON by default.
--
-- spoiler_revealed_through is a JSON map { [leagueId]: highestRevealedWeek }.
-- Revealing week N reveals weeks 1..N (catch-up), so a result for week W is
-- veiled until W <= revealedThrough[leagueId].
--
-- We also flip spoiler-free mode on for everyone: the schema default becomes
-- true (new rows) and this backfill turns it on for existing users.
ALTER TABLE `user_preferences` ADD `spoiler_revealed_through` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
UPDATE `user_preferences` SET `spoiler_free_mode` = 1;
