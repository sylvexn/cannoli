-- Per-league battle format. Determines move-legality for the draft board's
-- moveset display + matchup-center coverage scan. Default 'gen9natdex'
-- mirrors the historic behavior (one-size-fits-all NatDex). Other accepted
-- values: gen9ou, gen9uu, gen9ru, gen9nu, gen9pu, gen9lc, gen9ubers — see
-- frontend/src/data/pokemon-learnsets.ts → DraftFormat for the source of
-- truth list.
ALTER TABLE `leagues` ADD `format` text DEFAULT 'gen9natdex' NOT NULL;
--> statement-breakpoint

-- Draft template snapshots. A template captures the league-config knobs that
-- an admin would otherwise re-enter every new season: format, captain count,
-- banlist, tera banlist, plus a tier-list snapshot (so future tier-list edits
-- don't retroactively mutate old templates). When a template is applied via
-- the season wizard, those values seed the wizard's initial state — the
-- admin can still tweak before submitting.
CREATE TABLE `draft_templates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `format` text DEFAULT 'gen9natdex' NOT NULL,
  -- JSON: [{ tier: number, names: string[] }, ...] — frozen at save time.
  `tier_list_snapshot` text NOT NULL,
  -- JSON array of pokemon display names that are draft-banned in this template.
  `banlist` text DEFAULT '[]' NOT NULL,
  -- JSON array of pokemon display names that are tera-banned in this template.
  `tera_banlist` text DEFAULT '[]' NOT NULL,
  `captain_count` integer DEFAULT 2 NOT NULL,
  `point_cap` integer DEFAULT 110 NOT NULL,
  `roster_size` integer DEFAULT 11 NOT NULL,
  `created_at` text DEFAULT (datetime('now')),
  `created_by` integer REFERENCES `users`(`id`)
);
