-- Admin-chosen "effective week" for approved trades/FA requests. Nullable —
-- null means the old default behavior (league.currentWeek at approve time).
-- The swap still applies immediately; this only labels which week the ledger
-- (transactions.week / rosters.acquiredWeek) records it under.
ALTER TABLE `trades` ADD `effective_week` integer;--> statement-breakpoint
ALTER TABLE `fa_requests` ADD `effective_week` integer;
