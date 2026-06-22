-- Per-league roster BAND. rosterSize stays the DRAFT size (snake rounds); these
-- two nullable columns add an optional post-draft min/max range. NULL = unset →
-- effective bound falls back to rosterSize, so existing leagues are unchanged
-- (roster must hold exactly rosterSize mons). A league can now allow e.g.
-- min 10 / max 12 for free-agency adds/drops and uneven (N-for-M) trades.
ALTER TABLE `leagues` ADD `min_roster_size` integer;--> statement-breakpoint
ALTER TABLE `leagues` ADD `max_roster_size` integer;
