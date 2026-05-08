-- Net-new auto-pin defs added when the archive feature shipped.
-- Champion was DELETEd in 0022_real_awards.sql in favor of cannoli (best
-- regular-season record), but cannoli ≠ finals winner. Restore Champion
-- as a distinct playoff award. High Score, Steal of the Draft, and Sweeper
-- close other gaps the existing award set didn't cover.
--
-- INSERT OR IGNORE so re-running on a DB that already has these (e.g. an
-- env that was hand-seeded via seed.ts) is a no-op.

INSERT OR IGNORE INTO `pin_definitions` (`id`, `name`, `description`, `icon_name`, `color`, `category`, `is_auto`) VALUES
  ('champion',           'Champion',           'Won the league finals.',                                          'Crown',      '#fbbf24', 'season', 1),
  ('high-score',         'High Score',         'Most kills by a single Pokemon in a single match.',              'Flame',      '#ef4444', 'season', 1),
  ('steal-of-the-draft', 'Steal of the Draft', 'Best kills-per-point value on a drafted Pokemon.',               'TrendingUp', '#10b981', 'season', 1),
  ('sweeper',            'Sweeper',            'Most 6-0 sweeps recorded across the season.',                    'Swords',     '#a855f7', 'season', 1);
