-- Per-league structured rules document. One row per league; absence means the
-- API falls back to the cost-format default (lib/rules-defaults). `content` is a
-- JSON-serialized RulesContent blob. Supersedes site_settings.rules_text (global).
CREATE TABLE `league_rules` (
	`league_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`updated_at` text,
	`updated_by` text,
	FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action
);
