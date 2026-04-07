-- Per-team flag: have they locked in their tera captains for this draft cycle?
-- Draft → regular phase advance is gated on every team in the league having
-- this set. Defaults false; reset by startDraft + undoLastPick (when undo
-- kicks the league back to phase=draft).
ALTER TABLE `teams` ADD `captains_locked` integer DEFAULT 0 NOT NULL;
