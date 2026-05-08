-- Net-new manual pin def: Clodsire = Most Passive KOs.
-- S9 had the award; S10 dropped it. Defining it here so S9 archive pins can
-- reference the slug. Manual-only (is_auto = 0): no auto-derivation rule —
-- the league's elite-4 picks the winners by hand each season it returns.
--
-- INSERT OR IGNORE keeps re-runs idempotent on DBs that already seeded it.

INSERT OR IGNORE INTO `pin_definitions` (`id`, `name`, `description`, `icon_name`, `color`, `category`, `is_auto`) VALUES
  ('clodsire', 'Clodsire', 'Most passive KOs in a season.', 'Droplet', '#84cc16', 'season', 0);
