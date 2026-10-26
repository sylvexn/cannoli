/**
 * Per-Pokemon season stats, built from `match_pokemon` (what actually played)
 * rather than the team's CURRENT roster — so kills/deaths by traded, dropped or
 * admin-replaced mons survive. Cosmetic-forme name variants fold onto the
 * roster name via resolveRosterPokemonName.
 *
 * W/L is the match's winner (matchWinner: winnerTeamId first, score fallback),
 * so a 0-0 forfeit still credits a W/L. Only completed regular-season matches
 * count (playoffs never feed season stats, same as standings); the
 * results-reveal gate (`maxWeek`) is applied here so every caller honors it.
 */
import { db, schema } from '../db';
import { and, eq, sql } from 'drizzle-orm';
import { matchWinner } from './standings';
import { resolveRosterPokemonName } from './pokedex';

export interface PokemonSeasonStat {
  teamId: string;
  pokemonName: string;
  kills: number;
  deaths: number;
  gp: number;
  wins: number;
  losses: number;
}

export function pokemonSeasonStats(leagueId: string, maxWeek: number | null): PokemonSeasonStat[] {
  const rows = db.select({
    teamId: schema.matchPokemon.teamId,
    pokemonName: schema.matchPokemon.pokemonName,
    kills: schema.matchPokemon.kills,
    deaths: schema.matchPokemon.deaths,
    winnerTeamId: schema.matches.winnerTeamId,
    homeTeamId: schema.matches.homeTeamId,
    awayTeamId: schema.matches.awayTeamId,
    homeScore: schema.matches.homeScore,
    awayScore: schema.matches.awayScore,
  }).from(schema.matchPokemon)
    .innerJoin(schema.matches, eq(schema.matchPokemon.matchId, schema.matches.id))
    .where(and(
      eq(schema.matches.leagueId, leagueId),
      eq(schema.matches.status, 'completed'),
      eq(schema.matches.phase, 'regular'),
      maxWeek != null ? sql`${schema.matches.week} <= ${maxWeek}` : undefined,
    ))
    .all();

  const rosterByTeam = new Map<string, string[]>();
  for (const r of db.select({ teamId: schema.rosters.teamId, name: schema.rosters.pokemonName })
    .from(schema.rosters).innerJoin(schema.teams, eq(schema.rosters.teamId, schema.teams.id))
    .where(eq(schema.teams.leagueId, leagueId)).all()) {
    const a = rosterByTeam.get(r.teamId) ?? [];
    a.push(r.name);
    rosterByTeam.set(r.teamId, a);
  }

  const out = new Map<string, PokemonSeasonStat>();
  for (const r of rows) {
    const name = resolveRosterPokemonName(rosterByTeam.get(r.teamId) ?? [], r.pokemonName);
    const key = `${r.teamId}\u0000${name}`;
    const s = out.get(key) ?? { teamId: r.teamId, pokemonName: name, kills: 0, deaths: 0, gp: 0, wins: 0, losses: 0 };
    s.kills += r.kills; s.deaths += r.deaths; s.gp++;
    const w = matchWinner(r);
    if (w === r.teamId) s.wins++;
    else if (w != null) s.losses++;
    out.set(key, s);
  }
  return [...out.values()];
}
