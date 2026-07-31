-- Make `effective_week` real instead of a label.
--
-- Previously an approved trade / FA request swapped rosters immediately and
-- `effective_week` only stamped the ledger. Approving during week 6 "for week 7"
-- therefore changed the team's week-6 roster mid-week.
--
-- Now: an approval whose effective week is in the FUTURE is *scheduled* —
-- rosters are untouched until the league reaches that week, at which point the
-- apply-scheduled sweep runs it. `applied_at` distinguishes the two states:
--   status='accepted'/'approved' AND applied_at IS NULL  → scheduled, not yet live
--   status='accepted'/'approved' AND applied_at NOT NULL → applied to rosters
--
-- Backfill: every already-resolved row was applied under the old semantics, so
-- stamp it with its resolved_at (falling back to a non-null sentinel) — nothing
-- historical must be re-applied by the sweep.
ALTER TABLE `trades` ADD `applied_at` text;--> statement-breakpoint
ALTER TABLE `fa_requests` ADD `applied_at` text;--> statement-breakpoint
UPDATE `trades` SET `applied_at` = COALESCE(`resolved_at`, datetime('now')) WHERE `status` = 'accepted';--> statement-breakpoint
UPDATE `fa_requests` SET `applied_at` = COALESCE(`resolved_at`, datetime('now')) WHERE `status` = 'approved';
