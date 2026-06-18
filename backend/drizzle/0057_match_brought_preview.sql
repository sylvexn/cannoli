-- Derived cache of the 6 brought (team-preview) species per side, stored as
-- JSON `{home: string[], away: string[]}` in Cannoli naming and recovered
-- from replay_log. Renders the full 12-mon replay-card grid (including benched
-- mons that never appeared in battle). NULL for legacy/sim rows. Never feeds
-- usage/award/stats aggregates — those stay sourced from match_pokemon.
ALTER TABLE matches ADD COLUMN brought_preview text;
