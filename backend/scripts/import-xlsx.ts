/**
 * Import season data from xlsx files into SQLite.
 *
 * Standalone: bun run scripts/import-xlsx.ts
 * Module:     import { importSeason } from './import-xlsx';
 *
 * Reads from: ../plan/imports/*.xlsx
 * Writes to:  ./data/cannoli.db
 */

import XLSX from 'xlsx';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { hashSync } from 'bcryptjs';
import * as schema from '../src/db/schema';
import { getFormCategory } from '../src/lib/pokedex';

export const IMPORTS_DIR = resolve(import.meta.dir, '../imports');
const DB_PATH = resolve(import.meta.dir, '../data/cannoli.db');

const DEFAULT_USER_PASSWORD = 'password';

// Fallback colors by league position when a team sheet doesn't carry a color.
const TEAM_COLORS = [
  '#ee8130', '#6390f0', '#7ac74c', '#a33ea1',
  '#e2bf65', '#96d9d6', '#c22e28', '#a98ff3',
  '#f95587', '#b6a136', '#735797', '#b7b7ce',
];

/**
 * Each team's per-team sheet is themed with the coach's chosen color.
 * The B2 cell sits inside the colored band, so its solid fill is the team color.
 */
function readTeamColorFromSheet(wb: XLSX.WorkBook, abbrev: string): string | null {
  const ws = wb.Sheets[abbrev];
  if (!ws) return null;
  const cell = ws['B2'];
  const rgb = cell?.s?.fgColor?.rgb ?? cell?.s?.bgColor?.rgb;
  if (typeof rgb !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(rgb)) return null;
  // Skip neutral fills used for placeholder/template/utility sheets.
  if (/^(000000|FFFFFF|EFEFEF|434343|666666)$/i.test(rgb)) return null;
  return `#${rgb.toUpperCase()}`;
}

// ─── Color helpers ──────────────────────────────────────────────────────────
// Used to derive a user-accent secondary color from a single team color so
// CoachLink gradient text + avatar tinting reads as the team identity rather
// than the generic cyan→violet fallback. Tertiary stays null and the frontend
// blends primary+secondary at render time when needed.

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 50];
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Derive a complementary secondary from a team's primary color. Hue rotates
 *  +30°, saturation clamps to a readable band, and lightness pushes toward
 *  the middle so very dark or very light primaries still produce a usable
 *  gradient endpoint. */
export function deriveSecondaryFromTeamColor(primary: string): string {
  const [h, s, l] = hexToHsl(primary);
  const newH = (h + 30) % 360;
  const newS = Math.max(45, Math.min(85, s));
  // Push lightness toward 50 so dark/saturated team colors still read in text.
  const newL = l > 60 ? l - 18 : l + 18;
  return hslToHex(newH, newS, newL);
}

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

// ─── Season config ──────────────────────────────────────────────────────────

interface SeasonConfig {
  seasonNumber: number;
  files: { id: string; name: string; color: string; file: string }[];
  phase?: 'draft' | 'regular' | 'playoffs' | 'offseason';
  currentWeek?: number;
  totalWeeks?: number;
  /** Per-league forfeit handling. Omitted → schema default ('double_forfeit'). */
  forfeitPolicy?: 'double_forfeit' | 'admin_review';
  /** Teams that make the playoff bracket. Omitted → schema default (6). */
  playoffTeamCount?: number;
}

export const S10_CONFIG: SeasonConfig = {
  seasonNumber: 10,
  // S10 is imported from the XLSX then fully finalized by seed.ts: finals are
  // scored to the Discord-announced champions, finish positions stamped, and
  // phase advanced to 'offseason'. In live mode the season is also archived
  // (read-only). rewindToFinalsPending is still used internally as an
  // intermediate step to fabricate SF rows and create the finals match rows.
  phase: 'playoffs',
  currentWeek: 11,
  totalWeeks: 11,
  files: [
    { id: 'sapphire', name: 'Sapphire League', color: '#2563eb', file: 'Cannoli Sapphire Season 10.xlsx' },
    { id: 'ruby', name: 'Ruby League', color: '#dc2626', file: 'Cannoli Ruby Season 10.xlsx' },
    { id: 'emerald', name: 'Emerald League', color: '#16a34a', file: 'Cannoli Emerald Season 10.xlsx' },
  ],
};

export const S11_CONFIG: SeasonConfig = {
  seasonNumber: 11,
  // S11 launches with the draft already complete (rosters + tera captains come
  // in from the XLSX), so the leagues start live in regular-season week 1.
  phase: 'regular',
  currentWeek: 1,
  totalWeeks: 11,
  // S11 ruleset: forfeits are adjudicated case-by-case by admins (not auto
  // double-forfeit), and the playoff bracket is top 8. Costs (NatDex+) land
  // separately via `apply-s11-costs.ts` / `gen-tier-list.ts`.
  forfeitPolicy: 'admin_review',
  playoffTeamCount: 8,
  // League IDs are season-scoped and must be unique across the whole DB. S10
  // already owns the bare `sapphire`/`ruby`/`emerald` ids, and S9 uses `s9-*`,
  // so S11 takes `s11-*`. The current season is whichever has the highest
  // season number (see GET /api/leagues), so the prefix doesn't affect which
  // leagues surface as "current"; gem theming strips the prefix (leagueGem()).
  files: [
    { id: 's11-sapphire', name: 'Sapphire League', color: '#2563eb', file: 'Cannoli Sapphire Season 11.xlsx' },
    { id: 's11-ruby', name: 'Ruby League', color: '#dc2626', file: 'Cannoli Ruby Season 11.xlsx' },
    { id: 's11-emerald', name: 'Emerald League', color: '#16a34a', file: 'Cannoli Emerald Season 11.xlsx' },
  ],
};

export const S9_CONFIG: SeasonConfig = {
  seasonNumber: 9,
  phase: 'offseason',
  currentWeek: 11,
  totalWeeks: 11,
  files: [
    { id: 'sapphire', name: 'Sapphire League', color: '#2563eb', file: 'Cannoli Sapphire Season 9.xlsx' },
    { id: 'ruby', name: 'Ruby League', color: '#dc2626', file: 'Cannoli Ruby Season 9.xlsx' },
    { id: 'emerald', name: 'Emerald League', color: '#16a34a', file: 'Cannoli Emerald Season 9 .xlsx' },
  ],
};

// ─── Main ────────────────────────────────────────────────────────────────────

export interface ImportResult {
  /** Map of coach name → user ID for all created user accounts */
  coachUserIds: Map<string, number>;
  /** Map of coach name → team ID (e.g. 'sapphire-sas') */
  coachTeamIds: Map<string, string>;
}

/**
 * Read the Pokemon master sheet (tiers, costs, types, stats, abilities) plus
 * the Draft Board banlist from one S10/S11-layout XLSX and populate ONLY the
 * `pokemon` table. Shared by `importSeason` and the standalone
 * `importPokemonOnly` export. `INSERT OR IGNORE` makes it safe to call against
 * a DB that may already hold some Pokemon rows.
 */
function importPokemonReference(sqlite: Database, xlsxPath: string): number {
  console.log('Importing Pokemon reference data...');
  const refWb = XLSX.readFile(xlsxPath);
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

    // The Pokemon sheet lists tera-captain variants as duplicate rows with a
    // " (T)" suffix on the same species. Skip those — captain status is
    // tracked on rosters, not on the species reference table.
    if (isTeraCaptain(name)) continue;

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

  // Batch upsert pokemon. UPSERT (not INSERT OR IGNORE) so importing a newer
  // season over a DB already holding an older season's reference rows refreshes
  // tiers / bans / stats to the season being imported (latest-season-wins). The
  // roster insert below reads `pokemon.tier` for cost-at-draft, so the refresh
  // must land before rosters are written. Harmless for a single-season build
  // (insert into an empty table). Historical rosters keep their own
  // `cost_at_draft` snapshot, so refreshing the reference never rewrites them.
  const insertPokemon = sqlite.prepare(`
    INSERT INTO pokemon (name, type1, type2, hp, atk, def, spa, spd, spe, ability1, ability2, hidden_ability, tier, tera_banned, banned, form_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type1=excluded.type1, type2=excluded.type2,
      hp=excluded.hp, atk=excluded.atk, def=excluded.def,
      spa=excluded.spa, spd=excluded.spd, spe=excluded.spe,
      ability1=excluded.ability1, ability2=excluded.ability2, hidden_ability=excluded.hidden_ability,
      tier=excluded.tier, tera_banned=excluded.tera_banned, banned=excluded.banned,
      form_category=excluded.form_category
  `);
  for (const p of pokemonRows) {
    insertPokemon.run(
      p.name, p.type1, p.type2, p.hp, p.atk, p.def, p.spa, p.spd, p.spe,
      p.ability1, p.ability2, p.hiddenAbility, p.tier,
      p.teraBanned ? 1 : 0, p.banned ? 1 : 0,
      getFormCategory(p.name),
    );
  }
  console.log(`  Inserted ${pokemonRows.length} Pokemon`);
  return pokemonRows.length;
}

/**
 * Populate ONLY the `pokemon` reference table — no seasons, leagues, teams, or
 * matches. Used by the season simulator's `buildSimWorld()` so a synthetic
 * fictional draft has real tier/cost/type data to draft against without
 * importing any real S9/S10 team or match history.
 *
 * Picks the first available S10 XLSX from `backend/imports/`. The Pokemon
 * master sheet is identical across the three league files, so any one works.
 */
export function importPokemonOnly(sqlite: Database): number {
  for (const f of S10_CONFIG.files) {
    const path = resolve(IMPORTS_DIR, f.file);
    if (existsSync(path)) {
      return importPokemonReference(sqlite, path);
    }
  }
  throw new Error(
    `importPokemonOnly: no S10 XLSX found in ${IMPORTS_DIR} — expected one of: ` +
      S10_CONFIG.files.map((f) => f.file).join(', '),
  );
}

/**
 * Import a season's data from XLSX files.
 * Creates users for coaches if createUsers=true.
 */
export function importSeason(
  sqlite: Database,
  config: SeasonConfig,
  opts: { createUsers?: boolean; clearExisting?: boolean } = {},
): ImportResult {
  const { createUsers = false, clearExisting = false } = opts;
  const db = drizzle(sqlite, { schema });

  sqlite.exec('PRAGMA foreign_keys = OFF');

  if (clearExisting) {
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
  }

  const allCoachTeamIds = new Map<string, string>();
  const allCoachUserIds = new Map<string, number>();

  // ─── Season ──────────────────────────────────────────────────────────────

  console.log(`Creating season ${config.seasonNumber}...`);
  const seasonRow = db.insert(schema.seasons).values({
    seasonNumber: config.seasonNumber,
    pointCap: 110,
    teraCaptainSlots: 2,
  }).returning().get();
  const seasonId = seasonRow.id;
  // Lifecycle defaults applied per league below — phase/currentWeek/totalWeeks
  // moved off `seasons`.
  const leaguePhase = config.phase || 'regular';
  const leagueCurrentWeek = config.currentWeek ?? 11;
  const leagueTotalWeeks = config.totalWeeks ?? 11;

  // ─── Pokemon reference table (from any league's Pokemon sheet) ──────────

  importPokemonReference(sqlite, resolve(IMPORTS_DIR, config.files[0].file));

  // ─── Per-league data ─────────────────────────────────────────────────────

  for (const league of config.files) {
    console.log(`\nImporting ${league.name}...`);
    const wb = XLSX.readFile(resolve(IMPORTS_DIR, league.file));
    // Separate styled read used only for the team-color cell on each
    // team sheet — loading styles into the main workbook expands every
    // sheet's `!ref` and shifts sheet_to_json output by leading columns.
    const styledWb = XLSX.readFile(resolve(IMPORTS_DIR, league.file), { cellStyles: true });

    // Create league (lifecycle fields are per-league now)
    db.insert(schema.leagues).values({
      id: league.id,
      name: league.name,
      color: league.color,
      seasonId,
      phase: leaguePhase,
      currentWeek: leagueCurrentWeek,
      totalWeeks: leagueTotalWeeks,
      tradeDeadlineWeek: 7,
      ...(config.forfeitPolicy ? { forfeitPolicy: config.forfeitPolicy } : {}),
      ...(config.playoffTeamCount ? { playoffTeamCount: config.playoffTeamCount } : {}),
    }).run();

    // ─── Teams from Standings sheet ──────────────────────────────────────

    const standings = sheet(wb, 'Standings');
    const teamIds: string[] = [];
    const teamNameToId = new Map<string, string>();
    const coachToTeamId = new Map<string, string>();
    /** Coach name → team color hex. Used downstream to seed user accent
     *  colors so CoachLink renders each name in the team palette rather
     *  than the global fallback gradient. */
    const coachToTeamColor = new Map<string, string>();

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

      const teamColor =
        readTeamColorFromSheet(styledWb, abbrev) ||
        TEAM_COLORS[teamIds.length - 1] ||
        '#888888';
      coachToTeamColor.set(coach, teamColor);

      db.insert(schema.teams).values({
        id: teamId,
        leagueId: league.id,
        coachName: coach,
        teamName,
        teamAbbrev: abbrev,
        teamColor,
        rank,
      }).run();
    }
    console.log(`  ${teamIds.length} teams created`);

    // ─── Create user accounts for coaches ────────────────────────────────

    if (createUsers) {
      const passwordHash = hashSync(DEFAULT_USER_PASSWORD, 10);
      for (const [coach, teamId] of coachToTeamId) {
        // Normalize username: lowercase, strip everything that isn't a letter
        // or digit (spaces AND punctuation — e.g. a coach handle like
        // "Will (Peepis)" becomes "willpeepis", which is actually typeable at
        // the login form).
        const username = coach.toLowerCase().replace(/[^a-z0-9]/g, '');
        allCoachTeamIds.set(username, teamId);

        // Check if user already exists (same coach in multiple leagues across seasons)
        const existing = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(username) as any;
        let userId: number;
        if (existing) {
          userId = existing.id;
          // Backfill accent colors for users created before colors were seeded
          // (e.g. previously-imported S9 archive coaches). New imports take
          // precedence only when the existing row has nothing set, so manual
          // user customizations from the settings panel are preserved.
          const teamColor = coachToTeamColor.get(coach);
          if (teamColor) {
            sqlite.prepare(
              `UPDATE users
                  SET primary_color = COALESCE(primary_color, ?),
                      secondary_color = COALESCE(secondary_color, ?)
                WHERE id = ?`,
            ).run(teamColor, deriveSecondaryFromTeamColor(teamColor), userId);
          }
        } else {
          const teamColor = coachToTeamColor.get(coach) ?? null;
          const secondaryColor = teamColor ? deriveSecondaryFromTeamColor(teamColor) : null;
          const result = sqlite.prepare(
            'INSERT INTO users (username, password_hash, role, must_change_password, active, primary_color, secondary_color) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
          ).get(username, passwordHash, 'user', 1, 1, teamColor, secondaryColor) as any;
          userId = result.id;
        }
        allCoachUserIds.set(username, userId);

        // Link user to team
        sqlite.prepare('UPDATE teams SET user_id = ? WHERE id = ?').run(userId, teamId);
      }
      console.log(`  ${coachToTeamId.size} coach accounts created/linked`);
    }

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
          costAtDraft: tier,
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

      // ─── Nicknames (team-summary card on the team sheet) ─────────────────
      // Two 3-cell rows of Pokemon names (rows 13/22, cols Q/V/AA = 16/21/26)
      // pair with nickname rows directly below them (rows 14/23). Cells holding
      // the literal "NICKNAME" placeholder or the same string as the Pokemon
      // name (POW/GG fill the slot with the species itself) are ignored.
      const NICK_PAIRS: Array<{ nameRow: number; nickRow: number }> = [
        { nameRow: 12, nickRow: 13 }, // 1-indexed rows 13/14
        { nameRow: 21, nickRow: 22 }, // 1-indexed rows 22/23
      ];
      const NICK_COLS = [16, 21, 26]; // Q, V, AA

      const updateNickname = sqlite.prepare(
        'UPDATE rosters SET nickname = ? WHERE team_id = ? AND pokemon_name = ?',
      );
      let nickCount = 0;
      for (const pair of NICK_PAIRS) {
        const nameRow = teamSheet[pair.nameRow] || [];
        const nickRow = teamSheet[pair.nickRow] || [];
        for (const c of NICK_COLS) {
          const rawName = nameRow[c];
          const rawNick = nickRow[c];
          if (!rawName || typeof rawName !== 'string' || !rawName.trim()) continue;
          if (!rawNick || typeof rawNick !== 'string' || !rawNick.trim()) continue;
          const cleanName = normalizePokemonName(rawName.toString());
          const cleanNick = normalizePokemonName(rawNick.toString()).trim();
          if (!cleanNick) continue;
          if (cleanNick.toUpperCase() === 'NICKNAME') continue;
          if (cleanNick.toLowerCase() === cleanName.toLowerCase()) continue;
          const capped = cleanNick.slice(0, 40);
          updateNickname.run(capped, teamId, cleanName);
          nickCount++;
        }
      }
      if (nickCount > 0) {
        console.log(`  ${abbrev}: ${nickCount} nicknames`);
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

    // ─── Playoffs ────────────────────────────────────────────────────────

    const playoffSheet = sheet(wb, 'Playoffs');
    const ROUND_LABELS: Record<string, { round: string; week: number }> = {
      'Quarter Finals': { round: 'qf', week: 12 },
      'Semi Finals': { round: 'sf', week: 13 },
      'Finals': { round: 'f', week: 14 },
    };

    // Parse bracket: QF at cols 5-9, SF at cols 11-15, Finals at cols 17-21
    // Each matchup = 2 rows: higher seed row, then lower seed row
    // Col layout: seed, team name, W/L, score, matchId
    const bracketCols = [
      { startCol: 5, round: 'qf' },
      { startCol: 11, round: 'sf' },
      { startCol: 17, round: 'f' },
    ];

    let playoffMatchCount = 0;

    for (const bc of bracketCols) {
      const roundInfo = bc.round;
      const week = roundInfo === 'qf' ? 12 : roundInfo === 'sf' ? 13 : 14;

      // Scan for matchup pairs
      for (let i = 4; i < playoffSheet.length - 1; i++) {
        const row1 = playoffSheet[i] || [];
        const row2 = playoffSheet[i + 2] || []; // opponent is 2 rows below

        const team1Name = row1[bc.startCol + 1];
        const team2Name = row2[bc.startCol + 1];
        if (!team1Name || typeof team1Name !== 'string' || !team1Name.includes('(')) continue;
        if (!team2Name || typeof team2Name !== 'string' || !team2Name.includes('(')) continue;

        const team1Id = resolveTeamId(team1Name.toString());
        const team2Id = resolveTeamId(team2Name.toString());
        if (!team1Id || !team2Id) continue;

        const seed1 = parseInt(row1[bc.startCol]?.toString().replace(/[^0-9]/g, '') || '0') || 0;
        const seed2 = parseInt(row2[bc.startCol]?.toString().replace(/[^0-9]/g, '') || '0') || 0;
        const score1 = typeof row1[bc.startCol + 3] === 'number' ? row1[bc.startCol + 3] : null;
        const score2 = typeof row2[bc.startCol + 3] === 'number' ? row2[bc.startCol + 3] : null;

        // Check we haven't already inserted this matchup
        const existingMatch = sqlite.prepare(
          'SELECT id FROM matches WHERE league_id = ? AND playoff_round = ? AND home_team_id = ? AND away_team_id = ?'
        ).get(league.id, roundInfo, team1Id, team2Id);
        if (existingMatch) continue;

        const matchId = `${league.id}-${roundInfo}-${playoffMatchCount + 1}`;

        db.insert(schema.matches).values({
          id: matchId,
          leagueId: league.id,
          week,
          homeTeamId: team1Id,
          awayTeamId: team2Id,
          homeScore: score1,
          awayScore: score2,
          phase: 'playoffs',
          playoffRound: roundInfo,
          homeSeed: seed1,
          awaySeed: seed2,
        }).run();
        playoffMatchCount++;
      }
    }
    console.log(`  ${playoffMatchCount} playoff matches`);

    // ─── Playoff Match Stats ─────────────────────────────────────────────

    if (wb.SheetNames.includes('Playoff Match Stats')) {
      const playoffMatchStats = sheet(wb, 'Playoff Match Stats');
      let playoffPokemonCount = 0;

      // Same layout as regular match stats: columns of 11
      // Col 0 = Quarter Finals, Col 11 = Semi Finals, Col 22 = Finals
      const playoffRounds = [
        { colBase: 0, round: 'qf' },
        { colBase: 11, round: 'sf' },
        { colBase: 22, round: 'f' },
      ];

      for (const pr of playoffRounds) {
        for (let i = 6; i < playoffMatchStats.length; i++) {
          const row = playoffMatchStats[i] || [];
          const team1Name = row[pr.colBase + 1];
          if (!team1Name || typeof team1Name !== 'string' || !team1Name.includes('(')) continue;
          const team2Name = row[pr.colBase + 7];
          if (!team2Name || typeof team2Name !== 'string' || !team2Name.includes('(')) continue;

          const team1Id = resolveTeamId(team1Name.toString());
          const team2Id = resolveTeamId(team2Name.toString());
          if (!team1Id || !team2Id) continue;

          // Find matching playoff match
          const matchRow = sqlite.prepare(
            'SELECT id FROM matches WHERE league_id = ? AND playoff_round = ? AND ((home_team_id = ? AND away_team_id = ?) OR (home_team_id = ? AND away_team_id = ?))'
          ).get(league.id, pr.round, team1Id, team2Id, team2Id, team1Id) as any;
          if (!matchRow) continue;

          const isHomeFirst = sqlite.prepare(
            'SELECT home_team_id FROM matches WHERE id = ?'
          ).get(matchRow.id) as any;
          const t1IsHome = isHomeFirst?.home_team_id === team1Id;

          for (let j = i + 2; j < Math.min(i + 8, playoffMatchStats.length); j++) {
            const pRow = playoffMatchStats[j] || [];

            const homePokemon = pRow[pr.colBase + 1];
            if (homePokemon && typeof homePokemon === 'string' && homePokemon.trim()) {
              const cleanName = normalizePokemonName(homePokemon.toString());
              const isTera = isTeraCaptain(homePokemon.toString());
              db.insert(schema.matchPokemon).values({
                matchId: matchRow.id,
                teamId: t1IsHome ? team1Id : team2Id,
                pokemonName: cleanName,
                kills: parseInt(pRow[pr.colBase + 2]) || 0,
                deaths: parseInt(pRow[pr.colBase + 3]) || 0,
                teraUsed: isTera,
                teraType: isTera ? 'unknown' : null,
              }).run();
              playoffPokemonCount++;
            }

            const awayPokemon = pRow[pr.colBase + 7];
            if (awayPokemon && typeof awayPokemon === 'string' && awayPokemon.trim()) {
              const cleanName = normalizePokemonName(awayPokemon.toString());
              const isTera = isTeraCaptain(awayPokemon.toString());
              db.insert(schema.matchPokemon).values({
                matchId: matchRow.id,
                teamId: t1IsHome ? team2Id : team1Id,
                pokemonName: cleanName,
                kills: parseInt(pRow[pr.colBase + 6]) || 0,
                deaths: parseInt(pRow[pr.colBase + 5]) || 0,
                teraUsed: isTera,
                teraType: isTera ? 'unknown' : null,
              }).run();
              playoffPokemonCount++;
            }
          }
        }
      }
      console.log(`  ${playoffPokemonCount} playoff pokemon entries`);
    }

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

  console.log(`\n=== Season ${config.seasonNumber} Import Summary ===`);
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

  sqlite.exec('PRAGMA foreign_keys = ON');
  return { coachUserIds: allCoachUserIds, coachTeamIds: allCoachTeamIds };
}

// ─── Team logos (from the Setup sheet's IMAGE() formulas) ────────────────────

/**
 * The default/placeholder team logo on the Cannoli sheet template. Teams that
 * never set a custom logo all point at this same imgur image, so we treat it as
 * "no logo" and leave logo_path NULL (the UI then renders the colored
 * abbreviation tile instead of N identical generic images).
 */
const PLACEHOLDER_LOGO_ID = 'xvUVyL7';

/**
 * Import per-team logos for a season from each league's Setup sheet.
 *
 * The Setup sheet lists, per team: col K (index 10) = team abbreviation,
 * col O (index 14) = an `=IMAGE("https://i.imgur.com/….png")` formula holding
 * the logo URL. The `TeamLogo` component renders full http(s) URLs directly, so
 * we store the imgur URL straight into `teams.logo_path` — no file hosting.
 *
 * Returns the per-league lists of teams that are still on the placeholder logo
 * so the caller can report them.
 */
export function importTeamLogos(
  sqlite: Database,
  config: SeasonConfig,
): { set: number; placeholder: string[] } {
  let set = 0;
  const placeholder: string[] = [];
  const update = sqlite.prepare('UPDATE teams SET logo_path = ? WHERE id = ?');

  for (const league of config.files) {
    const wb = XLSX.readFile(resolve(IMPORTS_DIR, league.file), { cellFormula: true });
    const su = wb.Sheets['Setup'];
    if (!su) {
      console.log(`  WARNING: no Setup sheet in ${league.file} — skipping logos`);
      continue;
    }
    // Rows 5..16 (0-indexed 4..15) carry the 12 teams.
    for (let r = 4; r < 16; r++) {
      const abbrevCell = su[XLSX.utils.encode_cell({ r, c: 10 })];
      const logoCell = su[XLSX.utils.encode_cell({ r, c: 14 })];
      const abbrev = abbrevCell?.v;
      if (!abbrev || typeof abbrev !== 'string') continue;
      const teamId = `${league.id}-${abbrev.toLowerCase()}`;

      const url = (logoCell?.f || '').match(/https?:\/\/[^"&)]+/)?.[0] ?? null;
      if (!url || url.includes(PLACEHOLDER_LOGO_ID)) {
        placeholder.push(teamId);
        continue;
      }
      update.run(url, teamId);
      set++;
    }
  }
  console.log(`  logos set: ${set}; on placeholder: ${placeholder.length} [${placeholder.join(', ')}]`);
  return { set, placeholder };
}

// ─── Post-import: rewind a season's finals to "pending" ─────────────────────

/**
 * Roll a season's bracket forward to "finals pending":
 *   - QF results stay as imported (XLSX has them).
 *   - SF matches that don't have results yet get synthetic results filled
 *     in (higher seed wins 4-2). SF matches that ALREADY have results are
 *     left alone.
 *   - The finals match is then either updated or created, seeded with the
 *     two SF winners, and explicitly left WITHOUT a score / replay / status
 *     so the bracket renders as "finals pending".
 *
 * Idempotent — re-running re-derives the same SF winners, leaves SF rows
 * with their now-filled scores, and re-clears the finals match.
 *
 * Returns counts so callers can sanity-check.
 */
export function rewindToFinalsPending(sqlite: Database, leagueIds: string[]): {
  sfFabricated: number;
  finalsCleared: number;
  finalsCreated: number;
  matchPokemonDeleted: number;
} {
  let sfFabricated = 0;
  let finalsCleared = 0;
  let finalsCreated = 0;
  let matchPokemonDeleted = 0;

  for (const leagueId of leagueIds) {
    // ─── 1. Make sure semifinals have results ───────────────────────────
    type SfRow = {
      id: string;
      home_team_id: string;
      away_team_id: string;
      home_seed: number | null;
      away_seed: number | null;
      home_score: number | null;
      away_score: number | null;
    };
    const sfs = sqlite.prepare(
      `SELECT id, home_team_id, away_team_id, home_seed, away_seed, home_score, away_score
         FROM matches
        WHERE league_id = ? AND phase = 'playoffs' AND playoff_round = 'sf'
        ORDER BY id`,
    ).all(leagueId) as SfRow[];

    const sfWinners: string[] = [];
    for (const sf of sfs) {
      let winnerId: string | null = null;
      if (sf.home_score != null && sf.away_score != null && sf.home_score !== sf.away_score) {
        winnerId = sf.home_score > sf.away_score ? sf.home_team_id : sf.away_team_id;
      } else {
        // Fabricate: higher seed (= lower seed number) wins 4-2. If seeds
        // missing, default the home team as winner.
        const homeBetter = sf.home_seed != null && sf.away_seed != null
          ? sf.home_seed <= sf.away_seed
          : true;
        const homeScore = homeBetter ? 4 : 2;
        const awayScore = homeBetter ? 2 : 4;
        sqlite.prepare(
          `UPDATE matches
              SET home_score = ?, away_score = ?, status = 'completed',
                  completed_at = COALESCE(completed_at, datetime('now'))
            WHERE id = ?`,
        ).run(homeScore, awayScore, sf.id);
        winnerId = homeBetter ? sf.home_team_id : sf.away_team_id;
        sfFabricated++;
      }
      sfWinners.push(winnerId);
    }

    if (sfWinners.length < 2) continue;

    // ─── 2. Seed the finals match ───────────────────────────────────────
    const [winnerA, winnerB] = sfWinners;
    // Ordering: best seed (lowest number) on home side, when both seeds are
    // known. Falls back to the first SF winner as home.
    const teamA = sqlite.prepare(
      `SELECT id, rank FROM teams WHERE id = ?`,
    ).get(winnerA) as { id: string; rank: number | null } | undefined;
    const teamB = sqlite.prepare(
      `SELECT id, rank FROM teams WHERE id = ?`,
    ).get(winnerB) as { id: string; rank: number | null } | undefined;
    const aRank = teamA?.rank ?? 99;
    const bRank = teamB?.rank ?? 99;
    const homeId = aRank <= bRank ? winnerA : winnerB;
    const awayId = aRank <= bRank ? winnerB : winnerA;
    const homeSeed = aRank <= bRank ? aRank : bRank;
    const awaySeed = aRank <= bRank ? bRank : aRank;

    const existingFinal = sqlite.prepare(
      `SELECT id FROM matches WHERE league_id = ? AND phase = 'playoffs' AND playoff_round = 'f' LIMIT 1`,
    ).get(leagueId) as { id: string } | undefined;

    if (existingFinal) {
      // Wipe any per-mon stats and clear the result back to scheduled.
      const delResult = sqlite.prepare(
        `DELETE FROM match_pokemon WHERE match_id = ?`,
      ).run(existingFinal.id);
      matchPokemonDeleted += (delResult as unknown as { changes?: number }).changes ?? 0;

      sqlite.prepare(
        `UPDATE matches
            SET home_team_id = ?, away_team_id = ?,
                home_seed = ?, away_seed = ?,
                home_score = NULL, away_score = NULL,
                replay_url = NULL, replay_log = NULL,
                status = 'scheduled',
                started_at = NULL, completed_at = NULL,
                warnings = NULL, forfeited_by = NULL,
                ready_home = 0, ready_away = 0,
                ps_room_id = NULL
          WHERE id = ?`,
      ).run(homeId, awayId, homeSeed, awaySeed, existingFinal.id);
      finalsCleared++;
    } else {
      // Build a stable finals match ID. Week 14 mirrors the playoff convention.
      const finalsId = `${leagueId}-f-1`;
      sqlite.prepare(
        `INSERT INTO matches
            (id, league_id, week, home_team_id, away_team_id,
             phase, playoff_round, home_seed, away_seed, status)
         VALUES (?, ?, 14, ?, ?, 'playoffs', 'f', ?, ?, 'scheduled')`,
      ).run(finalsId, leagueId, homeId, awayId, homeSeed, awaySeed);
      finalsCreated++;
    }
  }

  return { sfFabricated, finalsCleared, finalsCreated, matchPokemonDeleted };
}

// ─── Post-import: fabricate a complete playoff bracket ─────────────────────

/**
 * Fill in missing semifinal + final matches so a league archive can render a
 * "fully played" bracket. The S9 importer produces only QF rows from its
 * messy playoff sheet; running this afterwards stamps SF (winners-of-QF
 * pairings) and a finals (SF winners) so `assignFinishPositions` can place
 * Champion / Runner-up / Semifinalist labels correctly.
 *
 * Heuristics (intentionally simple — this is mock data):
 *   - Walk QF rows in insert order (id ASC). Pair (1,2) → SF1, (3,4) → SF2.
 *     If a QF row has no scores, the higher seed (lower seed number) is
 *     treated as the winner.
 *   - SF winners: higher seed wins; synthetic 4-2 score.
 *   - Finals: higher seed wins; synthetic 4-3 score.
 *
 * Skips any league that already has SF or final rows — caller can rely on
 * "either the bracket exists or we built it".
 */
export function fabricatePlayoffBracket(
  sqlite: Database,
  leagueIds: string[],
): { sfsCreated: number; finalsCreated: number } {
  let sfsCreated = 0;
  let finalsCreated = 0;

  for (const leagueId of leagueIds) {
    type QfRow = {
      id: string;
      home_team_id: string;
      away_team_id: string;
      home_seed: number | null;
      away_seed: number | null;
      home_score: number | null;
      away_score: number | null;
    };
    const qfs = sqlite.prepare(
      `SELECT id, home_team_id, away_team_id, home_seed, away_seed, home_score, away_score
         FROM matches
        WHERE league_id = ? AND phase = 'playoffs' AND playoff_round = 'qf'
        ORDER BY id`,
    ).all(leagueId) as QfRow[];

    if (qfs.length === 0) continue;

    // Bail if SF or F already exist — don't double-stamp.
    const existing = sqlite.prepare(
      `SELECT COUNT(*) as c FROM matches
        WHERE league_id = ? AND phase = 'playoffs' AND playoff_round IN ('sf', 'f')`,
    ).get(leagueId) as { c: number };
    if (existing.c > 0) continue;

    // Resolve QF winner per row (fabricate if missing).
    const qfWinners: { teamId: string; seed: number }[] = [];
    for (const q of qfs) {
      let winnerTeam = q.home_team_id;
      let winnerSeed = q.home_seed ?? 99;
      if (q.home_score != null && q.away_score != null && q.home_score !== q.away_score) {
        if (q.away_score > q.home_score) {
          winnerTeam = q.away_team_id;
          winnerSeed = q.away_seed ?? 99;
        }
      } else {
        // No usable score: default to higher seed (lower seed number).
        const homeBetter = (q.home_seed ?? 99) <= (q.away_seed ?? 99);
        if (!homeBetter) {
          winnerTeam = q.away_team_id;
          winnerSeed = q.away_seed ?? 99;
        }
        // Also stamp a synthetic QF score so the standings page doesn't show
        // "match without result" later.
        const homeScore = homeBetter ? 4 : 2;
        const awayScore = homeBetter ? 2 : 4;
        sqlite.prepare(
          `UPDATE matches SET home_score = ?, away_score = ?, status = 'completed',
              completed_at = COALESCE(completed_at, datetime('now'))
            WHERE id = ?`,
        ).run(homeScore, awayScore, q.id);
      }
      qfWinners.push({ teamId: winnerTeam, seed: winnerSeed });
    }

    // Pair QF winners into semifinals. With an even count we just walk in
    // order: (qf1,qf2)→sf1, (qf3,qf4)→sf2. With an odd count (small leagues
    // with byes — common for 6-team brackets), the BEST-seeded QF winner
    // gets a bye straight to the finals, and the remaining N-1 QF winners
    // are paired into SFs as before.
    const sfWinners: { teamId: string; seed: number }[] = [];
    let sfIdx = 0;
    let pool = qfWinners;
    let byeFinalist: { teamId: string; seed: number } | null = null;
    if (pool.length % 2 === 1) {
      const bestIdx = pool.reduce(
        (best, w, i, arr) => (w.seed < arr[best].seed ? i : best),
        0,
      );
      byeFinalist = pool[bestIdx];
      pool = pool.filter((_, i) => i !== bestIdx);
    }
    for (let i = 0; i < pool.length - 1; i += 2) {
      const a = pool[i];
      const b = pool[i + 1];
      const aBetter = a.seed <= b.seed;
      const homeTeam = aBetter ? a.teamId : b.teamId;
      const awayTeam = aBetter ? b.teamId : a.teamId;
      const homeSeed = aBetter ? a.seed : b.seed;
      const awaySeed = aBetter ? b.seed : a.seed;
      const sfId = `${leagueId}-sf-${++sfIdx}`;
      sqlite.prepare(
        `INSERT INTO matches
           (id, league_id, week, home_team_id, away_team_id,
            phase, playoff_round, home_seed, away_seed,
            home_score, away_score, status, completed_at)
         VALUES (?, ?, 13, ?, ?, 'playoffs', 'sf', ?, ?, 4, 2, 'completed', datetime('now'))`,
      ).run(sfId, leagueId, homeTeam, awayTeam, homeSeed, awaySeed);
      sfWinners.push({ teamId: homeTeam, seed: homeSeed });
      sfsCreated++;
    }

    // Assemble finalist pool: SF winners + any bye finalist.
    const finalists = byeFinalist ? [byeFinalist, ...sfWinners] : sfWinners;
    if (finalists.length < 2) continue;

    // Final: best two finalists by seed.
    const sortedFinalists = [...finalists].sort((x, y) => x.seed - y.seed);
    const [a, b] = sortedFinalists;
    const homeTeam = a.teamId;
    const awayTeam = b.teamId;
    const homeSeed = a.seed;
    const awaySeed = b.seed;
    sqlite.prepare(
      `INSERT INTO matches
         (id, league_id, week, home_team_id, away_team_id,
          phase, playoff_round, home_seed, away_seed,
          home_score, away_score, status, completed_at)
       VALUES (?, ?, 14, ?, ?, 'playoffs', 'f', ?, ?, 4, 3, 'completed', datetime('now'))`,
    ).run(`${leagueId}-f-1`, leagueId, homeTeam, awayTeam, homeSeed, awaySeed);
    finalsCreated++;
  }

  return { sfsCreated, finalsCreated };
}

// ─── Post-import: assign finish_position + finish_label to teams ────────────

/**
 * Walk a season's playoff brackets per league and stamp `finish_position` /
 * `finish_label` on every team. Designed for archived (fully-played)
 * seasons: a finals match with no result will leave both finalists at
 * NULL (caller can opt to mark them as finalists differently if desired).
 *
 * Position scheme (single-elim, no third-place game):
 *   1  Champion        — finals winner
 *   2  Runner-up       — finals loser
 *   3  Semifinalist    — both SF losers (tied 3rd/4th)
 *   5  Quarterfinalist — all QF losers (tied 5th-8th)
 *   9+ Regular Season  — non-playoff teams; ranked by `teams.rank`
 */
export function assignFinishPositions(sqlite: Database, leagueIds: string[]): {
  teamsUpdated: number;
} {
  let teamsUpdated = 0;

  for (const leagueId of leagueIds) {
    const teams = sqlite.prepare(
      `SELECT id, rank FROM teams WHERE league_id = ? ORDER BY rank ASC`,
    ).all(leagueId) as { id: string; rank: number | null }[];
    if (teams.length === 0) continue;

    const playoffMatches = sqlite.prepare(
      `SELECT id, playoff_round, home_team_id, away_team_id, home_score, away_score
         FROM matches
         WHERE league_id = ? AND phase = 'playoffs'`,
    ).all(leagueId) as {
      id: string;
      playoff_round: string;
      home_team_id: string;
      away_team_id: string;
      home_score: number | null;
      away_score: number | null;
    }[];

    const eliminatedAt = new Map<string, 'qf' | 'sf' | 'f'>(); // round in which team lost
    let champion: string | null = null;
    let runnerUp: string | null = null;

    for (const m of playoffMatches) {
      if (m.home_score == null || m.away_score == null) continue;
      if (m.home_score === m.away_score) continue;
      const winner = m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
      const loser = m.home_score > m.away_score ? m.away_team_id : m.home_team_id;
      const round = m.playoff_round as 'qf' | 'sf' | 'f';
      eliminatedAt.set(loser, round);
      if (round === 'f') {
        champion = winner;
        runnerUp = loser;
      }
    }

    const update = sqlite.prepare(
      `UPDATE teams SET finish_position = ?, finish_label = ? WHERE id = ?`,
    );

    let regularRank = 9; // first non-playoff slot
    for (const t of teams) {
      let pos: number | null = null;
      let label: string | null = null;
      if (champion === t.id) {
        pos = 1;
        label = 'Champion';
      } else if (runnerUp === t.id) {
        pos = 2;
        label = 'Runner-up';
      } else if (eliminatedAt.get(t.id) === 'sf') {
        pos = 3;
        label = 'Semifinalist';
      } else if (eliminatedAt.get(t.id) === 'qf') {
        pos = 5;
        label = 'Quarterfinalist';
      } else {
        // Non-playoff team: position based on regular-season rank.
        pos = regularRank++;
        label = 'Regular Season';
      }
      update.run(pos, label, t.id);
      teamsUpdated++;
    }
  }

  return { teamsUpdated };
}

// ─── Standalone runner ──────────────────────────────────────────────────────

if (import.meta.main) {
  const sqlite = new Database(DB_PATH);
  sqlite.exec('PRAGMA journal_mode = WAL');

  // Import S10 (primary, clears existing)
  importSeason(sqlite, S10_CONFIG, { createUsers: true, clearExisting: true });

  // Import S9 (historical, uses separate import script)
  console.log('\n--- Importing S9 historical data ---');
  const { importS9 } = await import('./import-s9');
  importS9(sqlite);

  sqlite.close();
  console.log('\nAll imports done!');
}
