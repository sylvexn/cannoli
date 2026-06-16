-- PER-LEAGUE COST FORMATS. Until now a single global `pokemon` reference table
-- (tier / banned / tera_banned) priced every league identically. Real leagues
-- diverge: the Emerald format ("NatDex") bans paradoxes / legendaries / mythicals
-- entirely and prices megas + pseudos one point higher, while Ruby & Sapphire
-- run the fuller "NatDex+" sheet. We model this as named COST FORMATS that a
-- league points to (many leagues → one format), rather than per-league tables,
-- so Ruby & Sapphire share one editable sheet and can never silently drift.
--
-- `format_costs` is the per-format cost authority. `pokemon.tier/banned/
-- tera_banned` remains as the NatDex+ baseline + a last-resort fallback for any
-- species a format sheet doesn't carry. Resolution at read time is:
--   format_costs[(league.cost_format, name)]  ??  pokemon[name]
-- Populated from backend/imports/Costs.xlsx (NatDex / NatDex+ sheets) by
-- scripts/apply-cost-formats.ts — schema here, data there.
CREATE TABLE `format_costs` (
  -- Cost-format id, e.g. 'natdex' | 'natdexplus'. Free-form text so new formats
  -- can be added without a schema change.
  `cost_format` text NOT NULL,
  `pokemon_name` text NOT NULL,
  -- Draft point cost (1-20). 99 is the legacy "not draftable" sentinel; we store
  -- it AND set banned=1 so either signal works.
  `tier` integer DEFAULT 0 NOT NULL,
  `banned` integer DEFAULT 0 NOT NULL,
  `tera_banned` integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (`cost_format`, `pokemon_name`)
);
--> statement-breakpoint

-- Which cost format a league prices its pool against. Default 'natdexplus'
-- preserves the historic global behavior for every existing row; the data
-- script flips Emerald-family leagues to 'natdex'. Backfilled here too so a
-- DB that runs the migration but not the script still has Emerald restricted.
ALTER TABLE `leagues` ADD `cost_format` text DEFAULT 'natdexplus' NOT NULL;
--> statement-breakpoint

UPDATE `leagues` SET `cost_format` = 'natdex' WHERE `id` LIKE '%emerald%';
