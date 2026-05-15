-- Real S10 awards — replace the generic seed pin set with the league's
-- actual award schema (Elite 4 / Mix / Player categories).
--
-- Order matters: insert new defs first so the remap below can copy pin rows
-- onto them before we DELETE the obsolete defs (DELETE cascades to pins, so
-- anything we don't copy first is lost — that's intentional for the dropped
-- slugs).
--
-- Remap is collision-safe: uses INSERT OR IGNORE against the
-- (user_id, pin_def_id, season_id) unique index instead of UPDATE. Two of
-- the source slugs (sweep, champion) collapse onto cannoli, so a user
-- holding both for the same season would have failed an UPDATE on the
-- second remap. INSERT OR IGNORE just keeps the first copy and drops the
-- second silently.

-- ─── New pin definitions ───────────────────────────────────────────────────
-- Elite 4 awards (auto-stats for garchomp / cannoli / cynthia; admin for the
-- subjective ones).
INSERT INTO `pin_definitions` (`id`, `name`, `description`, `icon_name`, `color`, `category`, `is_auto`) VALUES
  ('garchomp',   'Garchomp',   'Most KOs in the season.',                                       'Skull',      '#84cc16', 'season',    1),
  ('baxcalibur', 'Baxcalibur', 'Best individual sweep of the season.',                          'Snowflake',  '#38bdf8', 'season',    0),
  ('kingambit',  'Kingambit',  'Best comeback of the season.',                                  'TrendingUp', '#dc2626', 'season',    0),
  ('ash',        'Ash',        'Most Improved Player (across all leagues).',                    'Sprout',     '#22c55e', 'career',    0),
  ('cannoli',    'Cannoli',    'Best regular-season record.',                                   'Trophy',     '#fbbf24', 'season',    1),
  ('cynthia',    'Cynthia',    'Longest win streak of the season.',                             'Flame',      '#f97316', 'season',    1),
  ('best-draft', 'Best Draft', 'Best drafted team, awarded at the start of the season.',        'Gem',        '#a855f7', 'draft',     0),
-- Mix awards (admin-decided; coaches vote, Elite 4 ratifies).
  ('dragapult',  'Dragapult',  'Most Valuable Player.',                                         'Star',       '#facc15', 'season',    0),
  ('charizard',  'Charizard',  'Low-Tier MVP.',                                                 'Coins',      '#fb923c', 'season',    0),
  ('florges',    'Florges',    'Best Tera Captain.',                                            'Flower2',    '#ec4899', 'season',    0),
  ('rotom',      'Rotom',      'Best Nickname.',                                                'Quote',      '#06b6d4', 'season',    0),
-- Player awards (player-voted).
  ('pikachu',    'Pikachu',    'Best Mascot.',                                                  'PartyPopper','#fde047', 'community', 0),
  ('red',        'Red',        'Best New Coach (across all leagues).',                          'UserPlus',   '#ef4444', 'career',    0);
--> statement-breakpoint

-- ─── Remap historical pins onto the new slugs ──────────────────────────────
-- mvp (top K/D, auto) → dragapult: copy preserving user/season/awarded_at/
-- awarded_by/metadata. The DELETE on pin_definitions below cascades old rows
-- away. Coaches can re-vote and the new pin gets re-issued with cleaner
-- metadata next season.
INSERT OR IGNORE INTO `pins` (`user_id`, `pin_def_id`, `season_id`, `awarded_at`, `awarded_by`, `metadata`)
  SELECT `user_id`, 'dragapult', `season_id`, `awarded_at`, `awarded_by`, `metadata`
  FROM `pins` WHERE `pin_def_id` = 'mvp';
--> statement-breakpoint

-- sweep (regular-season undefeated) → cannoli (best record). A perfect
-- season is the strongest possible best-record claim.
INSERT OR IGNORE INTO `pins` (`user_id`, `pin_def_id`, `season_id`, `awarded_at`, `awarded_by`, `metadata`)
  SELECT `user_id`, 'cannoli', `season_id`, `awarded_at`, `awarded_by`, `metadata`
  FROM `pins` WHERE `pin_def_id` = 'sweep';
--> statement-breakpoint

-- champion (finals winner) → cannoli. Not a perfect mapping — champion is a
-- playoff result and cannoli is regular-season — but it's the closest
-- season-prestige analog we have, and it preserves the historical award
-- count instead of CASCADE-deleting it. May collide with a sweep→cannoli
-- copy for the same user/season; INSERT OR IGNORE keeps the first.
INSERT OR IGNORE INTO `pins` (`user_id`, `pin_def_id`, `season_id`, `awarded_at`, `awarded_by`, `metadata`)
  SELECT `user_id`, 'cannoli', `season_id`, `awarded_at`, `awarded_by`, `metadata`
  FROM `pins` WHERE `pin_def_id` = 'champion';
--> statement-breakpoint

-- tera-maestro (most teras used) → florges (best tera captain). Same theme,
-- different criterion; close enough to preserve the awarded record.
INSERT OR IGNORE INTO `pins` (`user_id`, `pin_def_id`, `season_id`, `awarded_at`, `awarded_by`, `metadata`)
  SELECT `user_id`, 'florges', `season_id`, `awarded_at`, `awarded_by`, `metadata`
  FROM `pins` WHERE `pin_def_id` = 'tera-maestro';
--> statement-breakpoint

-- ─── Drop obsolete defs (cascades to any remaining pin rows) ──────────────
DELETE FROM `pin_definitions` WHERE `id` IN (
  'mvp', 'sweep', 'champion', 'tera-maestro',
  'iron-man', 'trade-machine', 'finalist', 'first-blood'
);
