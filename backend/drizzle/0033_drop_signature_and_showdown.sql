-- Drop three columns deprecated in WT-C cleanup:
--   * teams.showdown_username — PS battle→team mapping migrated to SSO
--     identity (the active sid session for `toUserid(users.username)`),
--     so the dedicated column is dead weight.
--   * users.signature_pokemon_id — signature-mons feature was fully
--     removed from the coach profile UI.
--   * users.signature_type — same; no surface still consumes it.
--
-- SQLite supports `ALTER TABLE ... DROP COLUMN` since 3.35; Bun's bundled
-- SQLite is well past that.
ALTER TABLE `teams` DROP COLUMN `showdown_username`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `signature_pokemon_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `signature_type`;
