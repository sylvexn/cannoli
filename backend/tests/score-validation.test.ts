import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { recordMatchResult } from '../src/lib/match-service';
import { validatePokemonData } from '../src/lib/match-validation';

describe('score validation', () => {
  test('recordMatchResult rejects fractional / negative / NaN scores', () => {
    const tag = `sv-${Date.now()}`;
    const seasonId = db.insert(schema.seasons).values({ seasonNumber: 988, archived: false }).returning().get().id;
    const leagueId = `${tag}-l`;
    const [t1, t2] = [`${tag}-1`, `${tag}-2`];
    const matchId = `${tag}-m`;
    try {
      db.insert(schema.leagues).values({ id: leagueId, name: tag, color: '#111', seasonId, phase: 'regular' }).run();
      db.insert(schema.teams).values([
        { id: t1, leagueId, coachName: 'A', teamName: 'A', teamAbbrev: 'A', teamColor: '#111111' },
        { id: t2, leagueId, coachName: 'B', teamName: 'B', teamAbbrev: 'B', teamColor: '#222222' },
      ]).run();
      db.insert(schema.matches).values({ id: matchId, leagueId, week: 1, homeTeamId: t1, awayTeamId: t2 }).run();

      for (const [h, a] of [[1.5, 0], [-1, 2], [Number.NaN, 1], [3, Infinity]] as const) {
        const r = recordMatchResult(matchId, { homeScore: h, awayScore: a }, 'test');
        expect(r.ok).toBe(false);
        expect(r.status).toBe(400);
      }
      expect(db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!.status).not.toBe('completed');
    } finally {
      db.delete(schema.matches).where(eq(schema.matches.id, matchId)).run();
      db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
      db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
      db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
    }
  });

  test('kills/deaths must be non-negative integers', () => {
    const roster = new Map([['h', new Set(['pikachu'])], ['a', new Set<string>()]]);
    const bad = validatePokemonData([{ teamId: 'h', pokemonName: 'Pikachu', kills: -1, deaths: 0.5 }], 'h', 'a', roster);
    expect(bad.ok).toBe(false);
    expect(bad.errors).toHaveLength(2);
    const good = validatePokemonData([{ teamId: 'h', pokemonName: 'Pikachu', kills: 2, deaths: 1 }], 'h', 'a', roster);
    expect(good.ok).toBe(true);
  });
});
