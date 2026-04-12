-- Pin / achievement system (Slice 3 of design pass).
--
-- Two tables:
--   pin_definitions — catalog of awardable pins. Seeded with the auto set
--                     (Champion, MVP, Iron Man, Sweep, Kingslayer, Flawless,
--                     Tera Maestro, Trade Machine, Finalist, First Blood);
--                     admins can mint new defs at runtime via the admin UI.
--   pins            — awarded instances (user × def × season).
--
-- Unique (user_id, pin_def_id, season_id) makes the auto-award job
-- idempotent: re-running it never inserts duplicate rows. NULL participates
-- in the unique constraint in SQLite, so season-agnostic pins can only be
-- awarded once per user.

CREATE TABLE `pin_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `icon_name` text DEFAULT 'Award' NOT NULL,
  `color` text DEFAULT '#fbbf24' NOT NULL,
  `category` text DEFAULT 'custom' NOT NULL,
  `is_auto` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint

CREATE TABLE `pins` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `pin_def_id` text NOT NULL,
  `season_id` integer,
  `awarded_at` text DEFAULT (datetime('now')),
  `awarded_by` integer,
  `metadata` text,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`pin_def_id`) REFERENCES `pin_definitions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`awarded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

CREATE UNIQUE INDEX `pins_user_def_season_idx` ON `pins` (`user_id`, `pin_def_id`, `season_id`);
--> statement-breakpoint

-- Seed the initial pin definitions (the auto set + a couple of manual classics).
-- Admins can edit/extend these from the admin UI; ids are the stable lookup keys
-- the auto-award job and any future code references rely on, so they're chosen
-- as kebab-case slugs and not changed.
INSERT INTO `pin_definitions` (`id`, `name`, `description`, `icon_name`, `color`, `category`, `is_auto`) VALUES
  ('champion',      'Champion',      'Won a season championship.',                                   'Crown',    '#fbbf24', 'career',    1),
  ('finalist',      'Finalist',      'Lost in the finals.',                                          'Medal',    '#cbd5e1', 'career',    1),
  ('first-blood',   'First Blood',   'Played in the inaugural season.',                              'Zap',      '#f87171', 'career',    0),
  ('mvp',           'MVP',           'Top season K/D among rostered Pokemon.',                       'Star',     '#facc15', 'season',    1),
  ('iron-man',      'Iron Man',      'Played every regular-season match without missing a week.',    'Shield',   '#94a3b8', 'season',    1),
  ('sweep',         'Sweep',         'Finished the regular season undefeated.',                      'Flame',    '#fb923c', 'season',    1),
  ('kingslayer',    'Kingslayer',    'Bottom-half team beat a top-3 team in a regular-season match.','Swords',   '#f472b6', 'week',      1),
  ('flawless',      'Flawless',      'Won a match without any of your Pokemon fainting.',            'Sparkles', '#a78bfa', 'week',      1),
  ('tera-maestro',  'Tera Maestro',  'Used the most teras across the season.',                       'Target',   '#22d3ee', 'draft',     1),
  ('trade-machine', 'Trade Machine', 'Completed five or more trades in a season.',                   'RefreshCw','#34d399', 'community', 1);
