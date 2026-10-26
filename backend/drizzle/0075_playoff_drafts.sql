-- Playoff bracket draft: staff arrange seeds here; `matches` rows are only created at publish,
-- so auto-forfeit / arena / deadlines / public readers never see an unapproved bracket.
CREATE TABLE `playoff_drafts` (
  `league_id` text PRIMARY KEY NOT NULL REFERENCES `leagues`(`id`) ON DELETE CASCADE,
  `status` text DEFAULT 'draft' NOT NULL,
  `top_n` integer NOT NULL,
  `seed_order` text NOT NULL,
  `pre_publish_week_dates` text,
  `created_by` text,
  `updated_by` text,
  `created_at` text DEFAULT (datetime('now')),
  `updated_at` text DEFAULT (datetime('now')),
  `published_at` text,
  `published_by` text
);
