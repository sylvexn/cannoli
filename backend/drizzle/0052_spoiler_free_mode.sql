-- Per-user opt-in spoiler-free mode. When true, the frontend blurs match
-- results (scores, winners, MVP/sweep/tera badges) on the standings and
-- replays pages behind a per-item click-to-reveal veil. Logic is React-side
-- (no CSS data-attr stamp); the column just persists the preference.
ALTER TABLE `user_preferences` ADD `spoiler_free_mode` integer DEFAULT 0 NOT NULL;
