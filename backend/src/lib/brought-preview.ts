/**
 * Brought-preview (team-of-6) recovery for replay cards.
 *
 * `match_pokemon` records only the mons that actually APPEARED in battle, so a
 * match that ends before all 6 are sent out leaves the replay card with empty
 * slots. The full brought team of 6 per side IS recoverable from the stored
 * battle log: the `|poke|` team-preview lines sit at the very start of the
 * protocol and survive log truncation. This module derives the brought sides
 * from a parsed result and infers the home/away orientation (there is no
 * persisted home/away → p1/p2 mapping on stored logs).
 *
 * Output is cached in `matches.brought_preview` and merged ONLY in the
 * replay-summary display endpoint. It never feeds usage/award/stats
 * aggregates — those stay sourced from `match_pokemon` (appeared-only).
 *
 * Pure / dependency-light by design (no db import) so it's unit-testable.
 */

import { ReplayParser, type ParsedMatchResult } from './replay-parser';
import { toCannoliSpeciesName } from './pokedex';

/** JSON contract persisted in `matches.brought_preview`. */
export interface BroughtSides {
  /** Up to 6 Cannoli-named species the HOME team brought (team preview). */
  home: string[];
  /** Up to 6 Cannoli-named species the AWAY team brought (team preview). */
  away: string[];
}

/**
 * Group the parsed result's brought (team-preview) mons by side, map species
 * to Cannoli naming, dedupe preserving order, and cap each side to 6.
 * `homeSide` says which parser side is the home team; the other is away.
 */
export function broughtSidesFromResult(
  result: ParsedMatchResult,
  homeSide: 'p1' | 'p2',
): BroughtSides {
  const awaySide: 'p1' | 'p2' = homeSide === 'p1' ? 'p2' : 'p1';

  const collect = (side: 'p1' | 'p2'): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const mon of result.pokemon) {
      if (mon.player !== side || !mon.brought) continue;
      const name = toCannoliSpeciesName(mon.species);
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
      if (out.length >= 6) break;
    }
    return out;
  };

  return { home: collect(homeSide), away: collect(awaySide) };
}

export interface InferHomeSideOpts {
  /** match_pokemon rows (appeared-only) already attributed to a teamId. */
  recorded: { teamId: string; pokemonName: string }[];
  homeTeamId: string | null;
  awayTeamId: string | null;
  /** Home team's roster species (Cannoli naming). */
  homeRoster: string[];
  /** Away team's roster species (Cannoli naming). */
  awayRoster: string[];
}

/**
 * Infer which parser side (p1/p2) is the home team.
 *
 * PRIMARY signal — match_pokemon overlap: for each parser side, take its
 * APPEARED species (Cannoli-normalized, lowercased) and count how many match
 * the recorded rows already attributed to the home team. The side with the
 * better home overlap (and at least one match) is home. The recorded rows are
 * the ground truth the live bot wrote with the resolved orientation, so this
 * pins orientation exactly when it's available.
 *
 * FALLBACK signal — roster ownership: count each side's appeared species
 * against home vs away rosters and pick the orientation with the higher
 * combined ownership.
 *
 * Returns null when genuinely undecidable (no appeared mons, no signal, or a
 * tie with no tiebreak).
 */
export function inferHomeSide(
  result: ParsedMatchResult,
  opts: InferHomeSideOpts,
): 'p1' | 'p2' | null {
  const appearedBySide = (side: 'p1' | 'p2'): Set<string> => {
    const set = new Set<string>();
    for (const mon of result.pokemon) {
      if (mon.player !== side || !mon.appeared) continue;
      set.add(toCannoliSpeciesName(mon.species).toLowerCase());
    }
    return set;
  };

  const p1Appeared = appearedBySide('p1');
  const p2Appeared = appearedBySide('p2');

  if (p1Appeared.size === 0 && p2Appeared.size === 0) return null;

  // PRIMARY: overlap with the home team's recorded (appeared) rows.
  if (opts.homeTeamId) {
    const homeRecorded = new Set(
      opts.recorded
        .filter(r => r.teamId === opts.homeTeamId)
        .map(r => toCannoliSpeciesName(r.pokemonName).toLowerCase()),
    );
    if (homeRecorded.size > 0) {
      const overlap = (s: Set<string>) => {
        let n = 0;
        for (const sp of s) if (homeRecorded.has(sp)) n++;
        return n;
      };
      const p1Home = overlap(p1Appeared);
      const p2Home = overlap(p2Appeared);
      if (p1Home > p2Home) return 'p1';
      if (p2Home > p1Home) return 'p2';
      // tie → fall through to roster signal
    }
  }

  // FALLBACK: roster ownership.
  const homeRoster = new Set(opts.homeRoster.map(s => s.toLowerCase()));
  const awayRoster = new Set(opts.awayRoster.map(s => s.toLowerCase()));
  const score = (s: Set<string>, roster: Set<string>) => {
    let n = 0;
    for (const sp of s) if (roster.has(sp)) n++;
    return n;
  };
  const p1Home = score(p1Appeared, homeRoster);
  const p1Away = score(p1Appeared, awayRoster);
  const p2Home = score(p2Appeared, homeRoster);
  const p2Away = score(p2Appeared, awayRoster);

  // Orientation A: p1=home, p2=away. Orientation B: p1=away, p2=home.
  const orientA = p1Home + p2Away;
  const orientB = p1Away + p2Home;
  if (orientA > orientB && orientA > 0) return 'p1';
  if (orientB > orientA && orientB > 0) return 'p2';

  return null;
}

export type ComputeBroughtOpts = InferHomeSideOpts;

/**
 * Parse a stored battle log, infer the home side, and return the brought
 * sides. Returns null if the log is unparseable, has no brought mons, or the
 * orientation is undecidable.
 */
export function computeBroughtPreviewFromLog(
  log: string,
  opts: ComputeBroughtOpts,
): BroughtSides | null {
  let result: ParsedMatchResult;
  try {
    result = ReplayParser.parse(log);
  } catch {
    return null;
  }
  if (result.pokemon.length === 0) return null;

  const homeSide = inferHomeSide(result, opts);
  if (!homeSide) return null;

  const sides = broughtSidesFromResult(result, homeSide);
  if (sides.home.length === 0 && sides.away.length === 0) return null;
  return sides;
}
