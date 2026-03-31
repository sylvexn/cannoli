-- Per-league roster size (= draft rounds). Replaces the hardcoded 10 in
-- draft-engine.ts so different leagues in the same season can run different
-- formats. Default 10 matches the historic value, so existing leagues are
-- unaffected.
ALTER TABLE `leagues` ADD `roster_size` integer DEFAULT 10 NOT NULL;
