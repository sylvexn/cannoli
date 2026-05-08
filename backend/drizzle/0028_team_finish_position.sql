-- Final placement for a team's league run. NULL while the league is still
-- in progress (regular/playoffs unfinished). Filled in once the bracket
-- resolves so profile/history surfaces can render finishing-badges
-- (Champion / Runner-up / Semifinalist / Quarterfinalist / Regular Season)
-- without recomputing from the matches table on every read.
--
-- `finish_position` is numeric (1 = Champion, 2 = Runner-up, 3 = tied
-- semifinalist, 5 = tied quarterfinalist, etc.), `finish_label` is the
-- pre-formatted string the UI displays alongside the badge.
ALTER TABLE `teams` ADD `finish_position` integer;--> statement-breakpoint
ALTER TABLE `teams` ADD `finish_label` text;
