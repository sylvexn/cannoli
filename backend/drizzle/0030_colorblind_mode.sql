-- Per-user opt-in for a deuteranopia-safe palette. When true, the frontend
-- tags <html data-colorblind="true"> and CSS overrides retarget red/green
-- tokens (--color-win/--color-loss, MATCHUP_COLORS) to orange/blue.
ALTER TABLE `user_preferences` ADD `colorblind_mode` integer DEFAULT 0 NOT NULL;
