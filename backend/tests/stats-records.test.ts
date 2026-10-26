/**
 * Stats read-side + record rules:
 *  - per-mon stats come from match_pokemon, so departed mons keep their kills
 *    (and cosmetic-forme names fold onto the roster name)
 *  - a 0-0 forfeit is a W/L (winner_team_id), never a draw
 *  - playoff matches never touch standings or per-mon stats ("record is record")
 *  - a playoff series counts as ONE win/loss however many games it took
 */
import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { computeStandings, computePlayoffRecords } from '../src/lib/standings';
import { pokemonSeasonStats } from '../src/lib/pokemon-season-stats';

try { sqlite.exec('PRAGMA busy_timeout = 15000'); } catch { /* best-effort */ }

const tag = `statsrec-${Date.now()}`;
const leagueId = `${tag}-lg`;
const A = `${tag}-A`;
const B = `${tag}-B`;
const C = `${tag}-C`;
let seasonId: number;

const mp = (matchId: string, teamId: string, pokemonName: string, kills: number, deaths: number) =>
  db.insert(schema.matchPokemon).values({ matchId, teamId, pokemonName, kills, deaths }).run();

beforeAll(() => {
  seasonId = db.insert(schema.seasons).values({
    seasonNumber: 8600 + (Date.now() % 1000), pointCap: 110, teraCaptainSlots: 2, archived: false,
  }).returning().get().id;
  db.insert(schema.leagues).values({
    id: leagueId, name: 'Stats Fixture', color: '#abcdef', seasonId,
    phase: 'playoffs', currentWeek: 3, draftOrder: JSON.stringify([A, B, C]),
  }).run();
  for (const [id, n] of [[A, 'Alpha'], [B, 'Bravo'], [C, 'Charlie']] as const) {
    db.insert(schema.teams).values({ id, leagueId, coachName: n, teamName: n, teamAbbrev: n.slice(0, 3) }).run();
  }
  // A's CURRENT roster has Garchomp + Furfrou; Beartic was dropped.
  db.insert(schema.rosters).values([
    { teamId: A, pokemonName: 'Garchomp', tier: 5 },
    { teamId: A, pokemonName: 'Furfrou', tier: 3 },
  ]).run();

  // w1: A beats B 4-2, with a departed mon and a cosmetic forme name.
  db.insert(schema.matches).values({
    id: `${tag}-w1`, leagueId, week: 1, phase: 'regular', homeTeamId: A, awayTeamId: B,
    homeScore: 4, awayScore: 2, winnerTeamId: A, status: 'completed',
  }).run();
  mp(`${tag}-w1`, A, 'Garchomp', 3, 0);
  mp(`${tag}-w1`, A, 'Beartic', 2, 1);
  mp(`${tag}-w1`, A, 'Furfrou-Star', 1, 0);
  mp(`${tag}-w1`, B, 'Pikachu', 2, 4);

  // w2: 0-0 forfeit-style result, B wins by flag.
  db.insert(schema.matches).values({
    id: `${tag}-w2`, leagueId, week: 2, phase: 'regular', homeTeamId: A, awayTeamId: B,
    homeScore: 0, awayScore: 0, winnerTeamId: B, status: 'completed',
  }).run();

  // Playoffs (week 3): a best-of-3 as three rows, B beats A 2-1.
  for (const [i, w] of [[1, B], [2, A], [3, B]] as const) {
    db.insert(schema.matches).values({
      id: `${tag}-p${i}`, leagueId, week: 3, phase: 'playoffs', playoffRound: 'sf',
      homeTeamId: A, awayTeamId: B, homeScore: w === A ? 6 : 0, awayScore: w === B ? 6 : 0,
      winnerTeamId: w, status: 'completed',
    }).run();
  }
  mp(`${tag}-p1`, A, 'Garchomp', 5, 1);
});

afterAll(() => {
  try {
    const ids = db.select({ id: schema.matches.id }).from(schema.matches).where(eq(schema.matches.leagueId, leagueId)).all().map(m => m.id);
    if (ids.length) db.delete(schema.matchPokemon).where(inArray(schema.matchPokemon.matchId, ids)).run();
    db.delete(schema.matches).where(eq(schema.matches.leagueId, leagueId)).run();
    db.delete(schema.rosters).where(inArray(schema.rosters.teamId, [A, B, C])).run();
    db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
    db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
    db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
  } catch { /* DB closed during suite teardown */ }
});

describe('per-Pokemon stats come from match_pokemon', () => {
  const stats = () => pokemonSeasonStats(leagueId, null).filter(s => s.teamId === A);

  test('a mon no longer on the roster keeps its kills/deaths', () => {
    const beartic = stats().find(s => s.pokemonName === 'Beartic')!;
    expect(beartic).toMatchObject({ kills: 2, deaths: 1, gp: 1, wins: 1, losses: 0 });
  });

  test('cosmetic-forme name folds onto the roster name', () => {
    const names = stats().map(s => s.pokemonName);
    expect(names).toContain('Furfrou');
    expect(names).not.toContain('Furfrou-Star');
  });

  test('playoff games stay out of per-mon season stats', () => {
    const chomp = stats().find(s => s.pokemonName === 'Garchomp')!;
    expect(chomp).toMatchObject({ kills: 3, deaths: 0, gp: 1 });
  });

  test('reveal gate: weeks past maxWeek are excluded', () => {
    expect(pokemonSeasonStats(leagueId, 0)).toEqual([]);
  });
});

describe('record rules', () => {
  test('0-0 forfeit is a win/loss, not a draw', () => {
    const s = computeStandings(leagueId);
    const b = s.find(r => r.id === B)!;
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(1);
  });

  test('playoff matches do not count toward standings', () => {
    const s = computeStandings(leagueId);
    const a = s.find(r => r.id === A)!;
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
    expect(a.kills).toBe(4);
  });

  test('a best-of-3 playoff series is one win / one loss', () => {
    const pr = computePlayoffRecords(leagueId);
    expect(pr.get(B)).toMatchObject({ wins: 1, losses: 0 });
    expect(pr.get(A)).toMatchObject({ wins: 0, losses: 1 });
    expect(pr.get(C)).toBeUndefined();
  });
});
