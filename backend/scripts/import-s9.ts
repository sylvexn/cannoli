/**
 * Import Season 9 data from xlsx files into SQLite.
 * S9 has a different sheet format from S10.
 *
 * Usage: bun run scripts/import-s9.ts
 */

import XLSX from 'xlsx';
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const IMPORTS_DIR = resolve(import.meta.dir, '../imports');
const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

interface LeagueConfig {
  id: string;
  name: string;
  color: string;
  file: string;
}

const LEAGUES: LeagueConfig[] = [
  { id: 's9-sapphire', name: 'Sapphire League', color: '#2563eb', file: 'Cannoli Sapphire Season 9.xlsx' },
  { id: 's9-ruby', name: 'Ruby League', color: '#dc2626', file: 'Cannoli Ruby Season 9.xlsx' },
  { id: 's9-emerald', name: 'Emerald League', color: '#16a34a', file: 'Cannoli Emerald Season 9 .xlsx' },
];

const TEAM_COLORS = [
  '#ee8130', '#6390f0', '#7ac74c', '#a33ea1',
  '#e2bf65', '#96d9d6', '#c22e28', '#a98ff3',
  '#f95587', '#b6a136', '#735797', '#b7b7ce',
];

function readTeamColorFromSheet(wb: XLSX.WorkBook, abbrev: string): string | null {
  const ws = wb.Sheets[abbrev];
  if (!ws) return null;
  const cell = ws['B2'];
  const rgb = cell?.s?.fgColor?.rgb ?? cell?.s?.bgColor?.rgb;
  if (typeof rgb !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(rgb)) return null;
  if (/^(000000|FFFFFF|EFEFEF|434343|666666)$/i.test(rgb)) return null;
  return `#${rgb.toUpperCase()}`;
}

function sheet(wb: XLSX.WorkBook, name: string): any[][] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found in workbook`);
  return XLSX.utils.sheet_to_json(ws, { header: 1 });
}

function normalizePokemonName(name: string): string {
  return name.replace(/\s*\(T\)\s*$/, '').trim();
}

export function importS9(db: Database) {
  db.exec('PRAGMA foreign_keys = OFF');

  // ─── Season 9 ──────────────────────────────────────────────────────────

  console.log('Creating Season 9...');
  const seasonRow = db.prepare(`INSERT INTO seasons (season_number, point_cap, tera_captain_slots)
    VALUES (?, ?, ?) RETURNING id`).get(9, 110, 2) as any;
  const seasonId = seasonRow.id;

  for (const league of LEAGUES) {
    console.log(`\nImporting ${league.name} (S9)...`);
    const wb = XLSX.readFile(resolve(IMPORTS_DIR, league.file));
    const styledWb = XLSX.readFile(resolve(IMPORTS_DIR, league.file), { cellStyles: true });

    // Create league (lifecycle fields per-league now)
    db.prepare(`INSERT INTO leagues (id, name, color, season_id, phase, current_week, total_weeks, trade_deadline_week)
      VALUES (?, ?, ?, ?, 'offseason', 11, 11, 7)`).run(
      league.id, league.name, league.color, seasonId
    );

    // ─── Teams from Standings ──────────────────────────────────────────

    const standings = sheet(wb, 'Standings');
    const teamIds: string[] = [];
    const abbrevToTeamId = new Map<string, string>();
    const coachToTeamId = new Map<string, string>();
    const nameToTeamId = new Map<string, string>();

    for (let i = 4; i < standings.length; i++) {
      const row = standings[i] || [];
      const teamName = row[3]?.toString().trim();
      const abbrev = row[4]?.toString().trim();
      const coach = row[5]?.toString().trim();
      const wins = parseInt(row[6]) || 0;
      const losses = parseInt(row[7]) || 0;

      if (!teamName || !abbrev) continue;

      const teamId = `${league.id}-${abbrev.toLowerCase()}`;
      const rankStr = row[2]?.toString().replace(/[^0-9]/g, '') || '';
      const rank = parseInt(rankStr) || teamIds.length + 1;

      teamIds.push(teamId);
      abbrevToTeamId.set(abbrev, teamId);
      coachToTeamId.set(coach, teamId);
      nameToTeamId.set(teamName, teamId);

      const teamColor =
        readTeamColorFromSheet(styledWb, abbrev) ||
        TEAM_COLORS[teamIds.length - 1] ||
        '#888888';

      // Link to a pre-existing user account by username (slug from coach name)
      // when one exists. The S10 import already created accounts for any
      // returning coaches, so this is the path that gives S9 archive teams a
      // userId — letting profile pages, lifetime stats, and the auto-pin job
      // recognise the same coach across both seasons.
      const slug = coach.toLowerCase().replace(/\s+/g, '');
      const userRow = db.prepare(
        `SELECT id FROM users WHERE username = ?`,
      ).get(slug) as { id: number } | undefined;
      const userId = userRow?.id ?? null;

      db.prepare(`INSERT INTO teams (id, league_id, user_id, coach_name, team_name, team_abbrev, team_color, rank)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        teamId, league.id, userId, coach, teamName, abbrev, teamColor, rank
      );
    }
    console.log(`  ${teamIds.length} teams`);

    function resolveTeamId(nameOrAbbrev: string): string | null {
      const s = nameOrAbbrev.trim();
      if (abbrevToTeamId.has(s)) return abbrevToTeamId.get(s)!;
      if (nameToTeamId.has(s)) return nameToTeamId.get(s)!;
      if (coachToTeamId.has(s)) return coachToTeamId.get(s)!;
      // Try partial match
      for (const [name, id] of nameToTeamId) {
        if (s.includes(name) || name.includes(s)) return id;
      }
      return null;
    }

    // ─── Rosters ───────────────────────────────────────────────────────

    const rosters = sheet(wb, 'Rosters');
    let rosterCount = 0;

    // Two groups of 6 teams each:
    // Group 1: row 1 = team names (cols 1,11,21,31,41,51), row 3 = abbreviations (cols 3,13,...), pokemon rows 5-16
    // Group 2: row 20 = team names, row 22 = abbreviations, pokemon rows 24-35
    const rosterGroups = [
      { nameRow: 1, abbrevRow: 3, startRow: 5, endRow: 17 },
      { nameRow: 20, abbrevRow: 22, startRow: 24, endRow: 36 },
    ];

    for (const group of rosterGroups) {
      const nameRow = rosters[group.nameRow] || [];
      const abbrevRow = rosters[group.abbrevRow] || [];

      // Find team columns: names at cols 1,11,21,31,41,51
      const teamCols: { pointsCol: number; nameCol: number; teamId: string }[] = [];
      for (let j = 0; j < 60; j++) {
        const abbrev = abbrevRow[j]?.toString().trim();
        if (abbrev && abbrevToTeamId.has(abbrev)) {
          // Points are 2 cols before the abbreviation, pokemon name at same col as abbrev
          teamCols.push({ pointsCol: j - 2, nameCol: j, teamId: abbrevToTeamId.get(abbrev)! });
        }
      }

      for (const tc of teamCols) {
        for (let i = group.startRow; i < Math.min(rosters.length, group.endRow); i++) {
          const row = rosters[i] || [];
          const points = parseInt(row[tc.pointsCol]) || 0;
          const pokemonName = row[tc.nameCol]?.toString().trim();
          if (!pokemonName || !points) continue;

          const cleanName = normalizePokemonName(pokemonName);
          const isTera = /\(T\)/.test(pokemonName);

          // Tera types (cols after pokemon name)
          let teraType1: string | null = null;
          let teraType2: string | null = null;
          let teraType3: string | null = null;
          if (isTera) {
            teraType1 = row[tc.nameCol + 1]?.toString().trim() || null;
            teraType2 = row[tc.nameCol + 2]?.toString().trim() || null;
            teraType3 = row[tc.nameCol + 3]?.toString().trim() || null;
            // Filter out non-type values
            const validTypes = new Set(['Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison','Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy']);
            if (teraType1 && !validTypes.has(teraType1)) teraType1 = null;
            if (teraType2 && !validTypes.has(teraType2)) teraType2 = null;
            if (teraType3 && !validTypes.has(teraType3)) teraType3 = null;
          }

          const tierResult = db.prepare('SELECT tier FROM pokemon WHERE name = ?').get(cleanName) as any;
          const tier = tierResult?.tier || points;

          db.prepare(`INSERT INTO rosters (team_id, pokemon_name, tier, is_tera_captain, tera_type1, tera_type2, tera_type3, acquired_via)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
            tc.teamId, cleanName, tier, isTera ? 1 : 0, teraType1, teraType2, teraType3, 'draft'
          );
          rosterCount++;
        }
      }
    }
    console.log(`  ${rosterCount} roster entries`);

    // ─── Draft picks from RawDrafts ────────────────────────────────────

    let draftCount = 0;
    if (wb.SheetNames.includes('RawDrafts')) {
      const rawDrafts = sheet(wb, 'RawDrafts');
      const teamPickCounts = new Map<string, number>();

      for (const row of rawDrafts) {
        const teamName = row[0]?.toString().trim();
        const pokemonName = row[1]?.toString().trim();
        const abbrev = row[2]?.toString().trim();
        if (!pokemonName || !abbrev) continue;

        const teamId = abbrevToTeamId.get(abbrev);
        if (!teamId) continue;

        const pickNum = (teamPickCounts.get(teamId) || 0) + 1;
        teamPickCounts.set(teamId, pickNum);

        const tierResult = db.prepare('SELECT tier FROM pokemon WHERE name = ?').get(normalizePokemonName(pokemonName)) as any;

        db.prepare(`INSERT INTO draft_picks (league_id, team_id, pick_number, pokemon_name, tier)
          VALUES (?, ?, ?, ?, ?)`).run(
          league.id, teamId, pickNum, normalizePokemonName(pokemonName), tierResult?.tier || 0
        );
        draftCount++;
      }
    }
    console.log(`  ${draftCount} draft picks`);

    // ─── Schedule ──────────────────────────────────────────────────────

    const scheduleSheet = sheet(wb, 'Schedule');
    let matchCount = 0;
    let currentWeek = 0;

    for (let i = 0; i < scheduleSheet.length; i++) {
      const row = scheduleSheet[i] || [];

      // Check for week headers — they contain "Week N" at cols 0, 6, 12, ...
      for (let wc = 0; wc < 18; wc += 6) {
        const weekLabel = row[wc]?.toString();
        if (weekLabel && weekLabel.startsWith('Week')) {
          // This row defines week labels for the columns below
          // Parse the week numbers
          continue;
        }
      }

      // Match rows: Team1 Score1 _ Score2 Team2 at offsets 0,6,12
      for (let wc = 0; wc < 18; wc += 6) {
        const team1Name = row[wc]?.toString().trim();
        const score1 = row[wc + 1];
        const score2 = row[wc + 3];
        const team2Name = row[wc + 4]?.toString().trim();

        if (!team1Name || !team2Name || typeof score1 !== 'number') continue;

        const team1Id = resolveTeamId(team1Name);
        const team2Id = resolveTeamId(team2Name);
        if (!team1Id || !team2Id) continue;

        // Determine week from position
        // Week headers at rows 1, 8, 15, 22, ... (every 7 rows starting at 1)
        // Week columns: col 0 = weeks 1,4,7,10; col 6 = weeks 2,5,8,11; col 12 = weeks 3,6,9
        const rowGroup = Math.floor((i - 2) / 7); // 0,1,2,3
        const colGroup = wc / 6; // 0,1,2
        const week = rowGroup * 3 + colGroup + 1;

        if (week < 1 || week > 11) continue;

        const matchId = `${league.id}-w${week}m${matchCount + 1}`;
        // Mark matches with scores as 'completed' so the auto-award job and
        // standings views treat them as final (S9 is fully archived).
        const status = typeof score1 === 'number' && typeof score2 === 'number'
          ? 'completed' : 'scheduled';
        db.prepare(`INSERT INTO matches (id, league_id, week, home_team_id, away_team_id, home_score, away_score, phase, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          matchId, league.id, week, team1Id, team2Id,
          typeof score1 === 'number' ? score1 : null,
          typeof score2 === 'number' ? score2 : null,
          'regular', status
        );
        matchCount++;
      }
    }
    console.log(`  ${matchCount} matches`);

    // ─── RawKills (per-pokemon per-week K/D) ───────────────────────────

    let killsCount = 0;
    if (wb.SheetNames.includes('RawKills')) {
      const rawKills = sheet(wb, 'RawKills');
      // Row 2 = headers (Pokemon, Team, then per-week: DK, PK, DD, PD, P, W)
      // Each week = 7 columns starting at col 2, 9, 16, 23, ...
      // Totals at cols 79+

      // We'll extract per-pokemon aggregate stats from the totals columns
      // Cols 90+ have: Pokemon, Team, Total Kills, Direct Kills, Passive Kills, Total Deaths, ...
      for (let i = 3; i < rawKills.length; i++) {
        const row = rawKills[i] || [];
        const pokemonName = row[90]?.toString().trim();
        const teamAbbrev = row[91]?.toString().trim();
        if (!pokemonName || !teamAbbrev || teamAbbrev === 'FREE') continue;

        const teamId = abbrevToTeamId.get(teamAbbrev);
        if (!teamId) continue;

        const totalKills = parseInt(row[93]) || 0;
        const totalDeaths = parseInt(row[96]) || 0;
        const gp = parseInt(row[100]) || 0;

        if (gp === 0) continue;

        // We don't have per-match data easily, but we can create aggregate entries
        // linked to a special "aggregate" match or update roster seasonStats
        // For now, store as match_pokemon with a synthetic match ID
        // This isn't ideal but lets the stats page work

        killsCount++;
      }
    }
    // Instead of per-match, let's just note the count — stats will compute from rosters
    console.log(`  ${killsCount} pokemon with stats (aggregate only)`);

    // ─── Playoffs ──────────────────────────────────────────────────────

    const playoffSheet = sheet(wb, 'Playoffs');
    let playoffCount = 0;

    // S9 playoff format: simpler layout
    // Matchup pairs with seed, team name, score at specific rows
    // Parse by scanning for seeds (numbers 1-8 in col 0)

    const playoffEntries: { seed: number; team: string; score: number | null; matchLabel: string | null; row: number }[] = [];

    for (let i = 0; i < playoffSheet.length; i++) {
      const row = playoffSheet[i] || [];

      // Check for matchup entries in QF (cols 0-2), SF (cols 3-4), Finals (cols 5-6)
      // QF: col 0 = seed, col 1 = team name, col 2 = score
      if (typeof row[0] === 'number' && row[0] >= 1 && row[0] <= 8 && row[1]) {
        playoffEntries.push({
          seed: row[0],
          team: row[1].toString().trim(),
          score: typeof row[2] === 'number' ? row[2] : null,
          matchLabel: null,
          row: i,
        });
      }

      // Check for match labels (M1, M2, etc.)
      for (let j = 2; j < 8; j++) {
        const val = row[j]?.toString().trim();
        if (val && /^M\d+$/.test(val)) {
          // Match label — the next row(s) have team info
          const team1Row = playoffSheet[i] || [];
          const teamName = team1Row[j + 1]?.toString().trim();
          const score = typeof team1Row[j + 2] === 'number' ? team1Row[j + 2] : null;
          if (teamName) {
            // Determine round from match label
            const matchNum = parseInt(val.replace('M', ''));
            let round = 'qf';
            if (matchNum >= 5 && matchNum <= 6) round = 'sf';
            if (matchNum >= 7) round = 'f';
          }
        }
      }
    }

    // Group into matchup pairs (consecutive entries)
    for (let i = 0; i < playoffEntries.length - 1; i += 2) {
      const e1 = playoffEntries[i];
      const e2 = playoffEntries[i + 1];

      const team1Id = resolveTeamId(e1.team);
      const team2Id = resolveTeamId(e2.team);
      if (!team1Id || !team2Id) continue;

      // Determine round from match index
      let round = 'qf';
      const matchIdx = i / 2;
      if (matchIdx >= 4) round = 'sf';
      if (matchIdx >= 6) round = 'f';

      const week = round === 'qf' ? 12 : round === 'sf' ? 13 : 14;
      const matchId = `${league.id}-${round}-${playoffCount + 1}`;

      const playoffStatus = e1.score != null && e2.score != null
        ? 'completed' : 'scheduled';
      db.prepare(`INSERT INTO matches (id, league_id, week, home_team_id, away_team_id, home_score, away_score, phase, playoff_round, home_seed, away_seed, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        matchId, league.id, week, team1Id, team2Id,
        e1.score, e2.score,
        'playoffs', round, e1.seed, e2.seed, playoffStatus
      );
      playoffCount++;
    }
    console.log(`  ${playoffCount} playoff matches`);

    // ─── Transactions from Trades sheet ─────────────────────────────────

    let txCount = 0;
    const tradesSheet = sheet(wb, 'Trades');

    for (let i = 4; i < tradesSheet.length; i++) {
      const row = tradesSheet[i] || [];
      const type = row[0]?.toString().trim();
      if (!type || (type !== 'FA' && type !== 'Trade' && type !== 'T')) continue;

      const team1Abbrev = row[1]?.toString().trim();
      const pokemonOut = row[2]?.toString().trim();
      const pointsOut = parseInt(row[4]) || 0;
      const team2Abbrev = row[6]?.toString().trim();
      const pokemonIn = row[7]?.toString().trim();
      const pointsIn = parseInt(row[9]) || 0;
      const week = parseInt(row[11]) || 0;

      const teamId = team1Abbrev ? abbrevToTeamId.get(team1Abbrev) : null;
      if (!teamId) continue;

      const txType = type === 'FA' ? 'fa' : 'trade';
      const otherTeamId = team2Abbrev && team2Abbrev !== team1Abbrev ? abbrevToTeamId.get(team2Abbrev) : null;

      db.prepare(`INSERT INTO transactions (league_id, week, type, team_id, other_team_id, pokemon_out, points_out, pokemon_in, points_in)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        league.id, week, txType, teamId, otherTeamId,
        pokemonOut ? normalizePokemonName(pokemonOut) : null, pointsOut || null,
        pokemonIn ? normalizePokemonName(pokemonIn) : null, pointsIn || null
      );
      txCount++;
    }
    console.log(`  ${txCount} transactions`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────

  console.log('\n=== S9 Import Summary ===');
  console.log('Season 9 teams:', (db.prepare("SELECT COUNT(*) as c FROM teams WHERE league_id LIKE 's9-%'").get() as any).c);
  console.log('Season 9 rosters:', (db.prepare("SELECT COUNT(*) as c FROM rosters WHERE team_id LIKE 's9-%'").get() as any).c);
  console.log('Season 9 matches:', (db.prepare("SELECT COUNT(*) as c FROM matches WHERE league_id LIKE 's9-%'").get() as any).c);
  console.log('Season 9 draft picks:', (db.prepare("SELECT COUNT(*) as c FROM draft_picks WHERE league_id LIKE 's9-%'").get() as any).c);
  console.log('Season 9 transactions:', (db.prepare("SELECT COUNT(*) as c FROM transactions WHERE league_id LIKE 's9-%'").get() as any).c);

  db.exec('PRAGMA foreign_keys = ON');
  console.log('\nS9 import done!');
}

// Standalone runner
if (import.meta.main) {
  const db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  importS9(db);
  db.close();
}
