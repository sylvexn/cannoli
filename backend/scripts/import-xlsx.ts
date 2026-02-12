/**
 * Import Season 10 data from xlsx files into SQLite.
 *
 * Usage: bun run scripts/import-xlsx.ts
 *
 * Reads from: ../plan/imports/*.xlsx
 * Writes to:  ./data/cannoli.db
 */

import XLSX from 'xlsx';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { resolve } from 'path';
import * as schema from '../src/db/schema';

const IMPORTS_DIR = resolve(import.meta.dir, '../../plan/imports');
const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

// ─── League config ───────────────────────────────────────────────────────────

interface LeagueConfig {
  id: string;
  name: string;
  color: string;
  file: string;
}

const LEAGUES: LeagueConfig[] = [
  { id: 'sapphire', name: 'Sapphire League', color: '#2563eb', file: 'Cannoli Sapphire Season 10.xlsx' },
  { id: 'ruby', name: 'Ruby League', color: '#dc2626', file: 'Cannoli Ruby Season 10.xlsx' },
  { id: 'emerald', name: 'Emerald League', color: '#16a34a', file: 'Cannoli Emerald Season 10.xlsx' },
];

// Team colors by league position (12 distinct colors)
const TEAM_COLORS = [
  '#ee8130', '#6390f0', '#7ac74c', '#a33ea1',
  '#e2bf65', '#96d9d6', '#c22e28', '#a98ff3',
  '#f95587', '#b6a136', '#735797', '#b7b7ce',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sheet(wb: XLSX.WorkBook, name: string): any[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found`);
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

/** Extract abbreviation from "Team Name (ABBREV)" format */
function extractAbbrev(s: string): string {
  const match = s.match(/\(([A-Z]+)\)/);
  return match ? match[1] : s;
}

/** Extract coach name from "Coach - Team Name (ABBREV)" format */
function extractCoach(s: string): string {
  const dash = s.indexOf(' - ');
  return dash > 0 ? s.slice(0, dash).trim() : s.trim();
}

/** Normalize pokemon name: strip " (T)" tera suffix */
function normalizePokemonName(name: string): string {
  return name.replace(/\s*\(T\)\s*$/, '').trim();
}

/** Check if pokemon name has tera marker "(T)" */
function isTeraCaptain(name: string): boolean {
  return /\(T\)\s*$/.test(name);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('Opening database:', DB_PATH);
  const sqlite = new Database(DB_PATH);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = OFF'); // Disable during import for speed
  const db = drizzle(sqlite, { schema });

  // Clear existing data
  sqlite.exec(`
    DELETE FROM match_pokemon;
    DELETE FROM matches;
    DELETE FROM transactions;
    DELETE FROM draft_picks;
    DELETE FROM rosters;
    DELETE FROM teams;
    DELETE FROM leagues;
    DELETE FROM seasons;
    DELETE FROM pokemon;
  `);

  // ─── Season ──────────────────────────────────────────────────────────────

  console.log('Creating season...');
  db.insert(schema.seasons).values({
    id: 1,
    seasonNumber: 10,
    phase: 'regular',
    currentWeek: 11,
    totalWeeks: 11,
    pointCap: 110,
    teraCaptainSlots: 2,
    tradeDeadlineWeek: 7,
  }).run();

  // ─── Pokemon reference table (from any league's Pokemon sheet) ──────────

  console.log('Importing Pokemon reference data...');
  const refWb = XLSX.readFile(resolve(IMPORTS_DIR, LEAGUES[0].file));
  const pokemonSheet = sheet(refWb, 'Pokemon');
  // Row 1 = headers: Pokemon, Pts, Sprite, Mono Sprite, Smogon Name, Github Name, BW Sprite, Type1, Type2, HP, ATK, DEF, SPA, SPD, SPE, Ability1, Ability2, Hidden Ability, Shiny, Pokemon, Tera Banned
  const pokemonRows: typeof schema.pokemon.$inferInsert[] = [];

  // Also parse the Draft Board to get banned list
  const draftBoard = sheet(refWb, 'Draft Board');
  // Row 3 has headers at cols 0,3,6,...: "Banned", "Tera Banned", "20 Points", etc.
  // Row 5+ has pokemon names at cols 1,4,7,... (offset +1 from headers)
  const bannedPokemon = new Set<string>();
  const teraBannedPokemon = new Set<string>();

  // Banned in col 1, Tera Banned in col 4
  for (let i = 5; i < draftBoard.length; i++) {
    const row = draftBoard[i] || [];
    if (row[1] && typeof row[1] === 'string' && row[1].trim()) {
      bannedPokemon.add(row[1].trim());
    }
    if (row[4] && typeof row[4] === 'string' && row[4].trim()) {
      teraBannedPokemon.add(row[4].trim());
    }
  }
  console.log(`  Found ${bannedPokemon.size} banned, ${teraBannedPokemon.size} tera-banned Pokemon`);

  for (let i = 3; i < pokemonSheet.length; i++) {
    const row = pokemonSheet[i] || [];
    const name = row[0];
    if (!name || typeof name !== 'string' || !name.trim()) continue;

    const pts = parseInt(row[1]) || 0;
    pokemonRows.push({
      name: name.trim(),
      type1: (row[7] || 'Normal').toString(),
      type2: row[8] ? row[8].toString() : null,
      hp: parseInt(row[9]) || 0,
      atk: parseInt(row[10]) || 0,
      def: parseInt(row[11]) || 0,
      spa: parseInt(row[12]) || 0,
      spd: parseInt(row[13]) || 0,
      spe: parseInt(row[14]) || 0,
      ability1: row[15] ? row[15].toString() : null,
      ability2: row[16] ? row[16].toString() : null,
      hiddenAbility: row[17] ? row[17].toString() : null,
      tier: pts,
      teraBanned: teraBannedPokemon.has(name.trim()),
      banned: bannedPokemon.has(name.trim()),
    });
  }

  // Batch insert pokemon
  const insertPokemon = sqlite.prepare(`
    INSERT OR IGNORE INTO pokemon (name, type1, type2, hp, atk, def, spa, spd, spe, ability1, ability2, hidden_ability, tier, tera_banned, banned)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of pokemonRows) {
    insertPokemon.run(p.name, p.type1, p.type2, p.hp, p.atk, p.def, p.spa, p.spd, p.spe, p.ability1, p.ability2, p.hiddenAbility, p.tier, p.teraBanned ? 1 : 0, p.banned ? 1 : 0);
  }
  console.log(`  Inserted ${pokemonRows.length} Pokemon`);

  // ─── Per-league data ─────────────────────────────────────────────────────

  for (const league of LEAGUES) {
    console.log(`\nImporting ${league.name}...`);
    const wb = XLSX.readFile(resolve(IMPORTS_DIR, league.file));

    // Create league
    db.insert(schema.leagues).values({
      id: league.id,
      name: league.name,
      color: league.color,
      seasonId: 1,
    }).run();

    // ─── Teams from Standings sheet ──────────────────────────────────────

    const standings = sheet(wb, 'Standings');
    const teamIds: string[] = [];
    const teamNameToId = new Map<string, string>();
    const coachToTeamId = new Map<string, string>();

    // Standings: rows 5,7,9,... have team data (alternating with W/L rows at 6,8,10,...)
    for (let i = 5; i < standings.length; i += 2) {
      const row = standings[i] || [];
      // Col 3 = "Coach - Team Name (ABBREV)"
      const fullName = row[3];
      if (!fullName || typeof fullName !== 'string' || !fullName.includes('(')) continue;

      const coach = extractCoach(fullName);
      const abbrev = extractAbbrev(fullName);
      const teamNameMatch = fullName.match(/- (.+?) \(/);
      const teamName = teamNameMatch ? teamNameMatch[1].trim() : abbrev;
      const rankStr = row[0]?.toString().replace(/[^0-9]/g, '') || '';
      const rank = parseInt(rankStr) || teamIds.length + 1;

      const teamId = `${league.id}-${abbrev.toLowerCase()}`;
      teamIds.push(teamId);
      teamNameToId.set(`${teamName} (${abbrev})`, teamId);
      teamNameToId.set(abbrev, teamId);
      coachToTeamId.set(coach, teamId);

      db.insert(schema.teams).values({
        id: teamId,
        leagueId: league.id,
        coachName: coach,
        teamName,
        teamAbbrev: abbrev,
        teamColor: TEAM_COLORS[teamIds.length - 1] || '#888888',
        rank,
      }).run();
    }
    console.log(`  ${teamIds.length} teams created`);

    // Build a lookup: team full name -> teamId
    function resolveTeamId(nameStr: string): string | null {
      if (!nameStr) return null;
      const s = nameStr.trim();
      // Try direct abbrev match
      const abbrevMatch = s.match(/\(([A-Z]+)\)/);
      if (abbrevMatch) {
        const tid = `${league.id}-${abbrevMatch[1].toLowerCase()}`;
        if (teamIds.includes(tid)) return tid;
      }
      // Try coach name
      for (const [coach, tid] of coachToTeamId) {
        if (s === coach || s.startsWith(coach + ' ')) return tid;
      }
      return null;
    }

    // ─── Rosters from team tabs ──────────────────────────────────────────

    // Team tabs are named by abbreviation (POW, AK, etc.)
    const sheetNames = wb.SheetNames;

    for (const teamId of teamIds) {
      const abbrev = teamId.split('-').pop()!.toUpperCase();
      if (!sheetNames.includes(abbrev)) {
        console.log(`  WARNING: No sheet for team ${abbrev}`);
        continue;
      }

      const teamSheet = sheet(wb, abbrev);

      // Find the roster header row (row 24) and detect column layout
      // Two known layouts:
      //   Layout A: Pokemon at col 17, tera names at col 3, tera types at col 8/10/12, shiny at col 15
      //   Layout B: Pokemon at col 15, tera names at col 1, tera types at col 6/8/10, shiny at col 13
      const headerRow = teamSheet[24] || [];
      let pokemonCol = -1;
      headerRow.forEach((v: any, i: number) => { if (v === 'Pokemon') pokemonCol = i; });

      if (pokemonCol === -1) {
        console.log(`  WARNING: Could not find Pokemon header for ${abbrev}`);
        continue;
      }

      // Derive other columns relative to the pokemon column
      // Pokemon col is either 15 or 17
      const nameCol = pokemonCol === 17 ? 3 : 1; // tera captain name column
      const teraTypeOffset = pokemonCol === 17 ? 8 : 6; // first tera type column
      const shinyCol = pokemonCol === 17 ? 15 : 13;

      let rosterCount = 0;
      for (let i = 25; i <= 34; i++) {
        const row = teamSheet[i] || [];
        const pokemonName = row[nameCol] || row[pokemonCol];
        if (!pokemonName || typeof pokemonName !== 'string' || !pokemonName.trim()) continue;

        const cleanName = normalizePokemonName(pokemonName.toString());
        const isTera = isTeraCaptain(pokemonName.toString());

        // Get tera types if it's a tera captain
        let teraType1: string | null = null;
        let teraType2: string | null = null;
        let teraType3: string | null = null;
        if (isTera) {
          teraType1 = row[teraTypeOffset] ? row[teraTypeOffset].toString() : null;
          teraType2 = row[teraTypeOffset + 2] ? row[teraTypeOffset + 2].toString() : null;
          teraType3 = row[teraTypeOffset + 4] ? row[teraTypeOffset + 4].toString() : null;
        }

        const isShiny = row[shinyCol] === 'Shiny';

        // Try to get tier from pokemon reference
        const tierResult = sqlite.prepare('SELECT tier FROM pokemon WHERE name = ?').get(cleanName) as any;
        const tier = tierResult?.tier || 0;

        db.insert(schema.rosters).values({
          teamId,
          pokemonName: cleanName,
          tier,
          isTeraCaptain: isTera,
          teraType1,
          teraType2,
          teraType3,
          isShiny,
          acquiredVia: 'draft',
        }).run();
        rosterCount++;
      }

      if (rosterCount > 0) {
        console.log(`  ${abbrev}: ${rosterCount} Pokemon on roster`);
      }
    }

    // ─── Draft picks ─────────────────────────────────────────────────────

    const draftSheet = sheet(wb, 'Draft');
    // Row 6 = "Coach:" row with team names at cols 2,6,10,14,18,22 (Pool A)
    // Row 7-16 = "Pick #1" through "Pick #10" with pts at cols 2,6,... and pokemon at cols 4,8,...
    // There might be Pool B starting further down

    let draftCount = 0;
    const poolStarts: number[] = [];

    // Find all "Coach:" rows
    for (let i = 0; i < draftSheet.length; i++) {
      const row = draftSheet[i] || [];
      if (row[0] === 'Coach:') poolStarts.push(i);
    }

    for (const poolRow of poolStarts) {
      const coachRow = draftSheet[poolRow] || [];
      // Coaches at cols 2, 6, 10, 14, 18, 22
      const teamCols = [2, 6, 10, 14, 18, 22];

      for (const col of teamCols) {
        const coachAbbrev = coachRow[col];
        if (!coachAbbrev || typeof coachAbbrev !== 'string') continue;

        const teamId = resolveTeamId(coachAbbrev) || `${league.id}-${coachAbbrev.toLowerCase()}`;
        if (!teamIds.includes(teamId)) continue;

        // Read picks (rows poolRow+1 through poolRow+10)
        for (let pickIdx = 1; pickIdx <= 12; pickIdx++) {
          const pickRow = draftSheet[poolRow + pickIdx] || [];
          const pts = parseInt(pickRow[col]);
          const pokemon = pickRow[col + 2];
          if (!pts || !pokemon || typeof pokemon !== 'string' || !pokemon.trim()) continue;

          const cleanName = normalizePokemonName(pokemon.toString());

          db.insert(schema.draftPicks).values({
            leagueId: league.id,
            teamId,
            pickNumber: pickIdx,
            pokemonName: cleanName,
            tier: pts,
          }).run();
          draftCount++;
        }
      }
    }
    console.log(`  ${draftCount} draft picks`);

    // ─── Schedule + Match results ────────────────────────────────────────

    const scheduleSheet = sheet(wb, 'Schedule');
    // Layout: weeks separated by "Week #N" label rows
    // Each match row: col 6 = Team1 name, col 7 = R(result), col 8 = S(score), col 9 = "vs.", col 10 = S, col 11 = R, col 12 = Team2 name

    let currentWeek = 0;
    let matchCount = 0;

    for (let i = 2; i < scheduleSheet.length; i++) {
      const row = scheduleSheet[i] || [];

      // Check for week header
      if (row[0] && typeof row[0] === 'string' && row[0].startsWith('Week #')) {
        currentWeek = parseInt(row[0].replace('Week #', '')) || 0;
        continue;
      }

      // Match row: col 6 has team name
      const team1Name = row[6];
      if (!team1Name || typeof team1Name !== 'string' || !team1Name.includes('(')) continue;

      const team2Name = row[12];
      if (!team2Name || typeof team2Name !== 'string') continue;

      const team1Id = resolveTeamId(team1Name.toString());
      const team2Id = resolveTeamId(team2Name.toString());
      if (!team1Id || !team2Id) continue;

      const result1 = row[7]; // W or L
      const score1 = row[8]; // numeric score
      const score2 = row[10];

      // Determine home/away scores
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      if (typeof score1 === 'number' && typeof score2 === 'number') {
        homeScore = score1;
        awayScore = score2;
      }

      const matchId = `${league.id}-w${currentWeek}m${matchCount + 1}`;

      db.insert(schema.matches).values({
        id: matchId,
        leagueId: league.id,
        week: currentWeek,
        homeTeamId: team1Id,
        awayTeamId: team2Id,
        homeScore,
        awayScore,
        phase: 'regular',
      }).run();
      matchCount++;
    }
    console.log(`  ${matchCount} matches`);

    // ─── Match Stats (per-pokemon K/D) ───────────────────────────────────

    const matchStats = sheet(wb, 'Match Stats');
    // Layout: 15 weeks horizontally, each 11 cols wide
    // Row 5 = week labels at cols 0, 11, 22, ...
    // Row 6+ = match blocks (each match = 1 header row + 6 pokemon rows + gap)
    // Match header: col offset+1 = Team1, offset+2 = R, offset+3 = Score1, offset+5 = Score2, offset+6 = R, offset+7 = Team2
    // Pokemon rows: col offset+1 = Pokemon1, offset+2 or +3 = K1, offset+3 or +5 = D1, offset+5 = D2, offset+6 = K2, offset+7 = Pokemon2

    // Approach: iterate per week (column offset), then per match block (row groups)
    let matchPokemonCount = 0;

    for (let weekIdx = 0; weekIdx < 11; weekIdx++) {
      const colBase = weekIdx * 11;
      const week = weekIdx + 1;

      // Find match header rows for this week column
      for (let i = 6; i < matchStats.length; i++) {
        const row = matchStats[i] || [];
        const team1Name = row[colBase + 1];
        if (!team1Name || typeof team1Name !== 'string' || !team1Name.includes('(')) continue;

        const team2Name = row[colBase + 7];
        if (!team2Name || typeof team2Name !== 'string' || !team2Name.includes('(')) continue;

        const score1 = row[colBase + 3];
        const score2 = row[colBase + 5];

        const team1Id = resolveTeamId(team1Name.toString());
        const team2Id = resolveTeamId(team2Name.toString());
        if (!team1Id || !team2Id) continue;

        // Find the corresponding match in DB
        const matchRow = sqlite.prepare(
          `SELECT id FROM matches WHERE league_id = ? AND week = ? AND home_team_id = ? AND away_team_id = ?`
        ).get(league.id, week, team1Id, team2Id) as any;

        // Try reversed
        const matchRowRev = !matchRow ? sqlite.prepare(
          `SELECT id FROM matches WHERE league_id = ? AND week = ? AND home_team_id = ? AND away_team_id = ?`
        ).get(league.id, week, team2Id, team1Id) as any : null;

        const matchId = matchRow?.id || matchRowRev?.id;
        if (!matchId) continue;

        // Read pokemon K/D rows (next 6 rows after header, skipping 1 empty row)
        for (let j = i + 2; j < Math.min(i + 8, matchStats.length); j++) {
          const pRow = matchStats[j] || [];

          // Home team pokemon (left side)
          const homePokemon = pRow[colBase + 1];
          if (homePokemon && typeof homePokemon === 'string' && homePokemon.trim()) {
            const cleanName = normalizePokemonName(homePokemon.toString());
            const isTera = isTeraCaptain(homePokemon.toString());

            // K at col+2 or col+3, D at col+3 or col+5
            // The layout is: Spr(col+0), Pokemon(col+1), K(col+2), D(col+3), [gap col+4], D(col+5), K(col+6), Pokemon(col+7)
            const kills = parseInt(pRow[colBase + 2]) || 0;
            const deaths = parseInt(pRow[colBase + 3]) || 0;

            db.insert(schema.matchPokemon).values({
              matchId,
              teamId: matchRow ? team1Id : team2Id,
              pokemonName: cleanName,
              kills,
              deaths,
              teraUsed: isTera,
              teraType: isTera ? 'unknown' : null,
            }).run();
            matchPokemonCount++;
          }

          // Away team pokemon (right side)
          const awayPokemon = pRow[colBase + 7];
          if (awayPokemon && typeof awayPokemon === 'string' && awayPokemon.trim()) {
            const cleanName = normalizePokemonName(awayPokemon.toString());
            const isTera = isTeraCaptain(awayPokemon.toString());

            const kills = parseInt(pRow[colBase + 6]) || 0;
            const deaths = parseInt(pRow[colBase + 5]) || 0;

            db.insert(schema.matchPokemon).values({
              matchId,
              teamId: matchRow ? team2Id : team1Id,
              pokemonName: cleanName,
              kills,
              deaths,
              teraUsed: isTera,
              teraType: isTera ? 'unknown' : null,
            }).run();
            matchPokemonCount++;
          }
        }
      }
    }
    console.log(`  ${matchPokemonCount} match pokemon entries`);

    // ─── Transactions ────────────────────────────────────────────────────

    const txSheet = sheet(wb, 'Transactions');
    let txCount = 0;

    for (let i = 3; i < txSheet.length; i++) {
      const row = txSheet[i] || [];
      const eventNum = row[0];
      if (!eventNum || typeof eventNum !== 'number') continue;

      const eventType = row[1]?.toString().trim(); // "F/A.", "Trade", "Tera Change"
      const coach1 = row[2]?.toString().trim();
      const pokemon1 = row[3]?.toString().trim(); // Pokemon given/dropped
      const pts1 = parseInt(row[5]) || 0;
      const pts2 = parseInt(row[6]) || 0;
      const pokemon2 = row[8]?.toString().trim(); // Pokemon received/picked up
      const coach2 = row[9]?.toString().trim();
      const week = parseInt(row[11]) || 0;

      const teamId = resolveTeamId(coach1 || '');
      if (!teamId) continue;

      let type: 'fa' | 'trade' | 'tera_change' = 'fa';
      if (eventType?.includes('Trade') || eventType === 'T.') type = 'trade';
      else if (eventType?.includes('Tera')) type = 'tera_change';

      const otherTeamId = coach2 && coach2 !== coach1 ? resolveTeamId(coach2) : null;

      db.insert(schema.transactions).values({
        leagueId: league.id,
        week,
        type,
        teamId,
        otherTeamId,
        pokemonOut: pokemon1 ? normalizePokemonName(pokemon1) : null,
        pointsOut: pts1 || null,
        pokemonIn: pokemon2 ? normalizePokemonName(pokemon2) : null,
        pointsIn: pts2 || null,
        teraPokemon: type === 'tera_change' ? normalizePokemonName(pokemon1 || '') : null,
      }).run();
      txCount++;
    }
    console.log(`  ${txCount} transactions`);

    // ─── Update roster acquisition method from transactions ──────────────

    const allTx = sqlite.prepare(
      `SELECT * FROM transactions WHERE league_id = ? ORDER BY week`
    ).all(league.id) as any[];

    for (const tx of allTx) {
      if (tx.type === 'fa' && tx.pokemon_in) {
        sqlite.prepare(
          `UPDATE rosters SET acquired_via = 'fa', acquired_week = ? WHERE team_id = ? AND pokemon_name = ?`
        ).run(tx.week, tx.team_id, tx.pokemon_in);
      } else if (tx.type === 'trade' && tx.pokemon_in) {
        sqlite.prepare(
          `UPDATE rosters SET acquired_via = 'trade', acquired_week = ? WHERE team_id = ? AND pokemon_name = ?`
        ).run(tx.week, tx.team_id, tx.pokemon_in);
      }
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────

  console.log('\n=== Import Summary ===');
  const counts = {
    pokemon: (sqlite.prepare('SELECT COUNT(*) as c FROM pokemon').get() as any).c,
    teams: (sqlite.prepare('SELECT COUNT(*) as c FROM teams').get() as any).c,
    rosters: (sqlite.prepare('SELECT COUNT(*) as c FROM rosters').get() as any).c,
    draftPicks: (sqlite.prepare('SELECT COUNT(*) as c FROM draft_picks').get() as any).c,
    matches: (sqlite.prepare('SELECT COUNT(*) as c FROM matches').get() as any).c,
    matchPokemon: (sqlite.prepare('SELECT COUNT(*) as c FROM match_pokemon').get() as any).c,
    transactions: (sqlite.prepare('SELECT COUNT(*) as c FROM transactions').get() as any).c,
  };
  console.log(counts);

  sqlite.close();
  console.log('\nDone!');
}

main();
