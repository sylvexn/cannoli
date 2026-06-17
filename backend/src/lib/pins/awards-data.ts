/**
 * Authoritative manual award lists for the seasons whose Discord-announced
 * winners we have on file. The auto-award job + archive-mint between them
 * cover champion / cannoli (best record) / cynthia (streak) / garchomp (KOs)
 * and the four archive pins; everything else (the Elite-4 / Mix / Player
 * categories) is hand-chosen and lives here.
 *
 * Two reference flavours per row:
 *   - `username` form    → user lookup is direct, the pin is filed against
 *                          the chosen leagueId in metadata.
 *   - `pokemon` form     → look up the rosters row that league + pokemon name
 *                          to find the team, then the pin goes to the team's
 *                          owner. Used for Pokemon-headlined awards (MVP,
 *                          most KOs, best nickname, etc).
 *
 * `mintManualPins` is the orchestrator. Idempotent: every insert is
 * INSERT OR IGNORE on (user_id, pin_def_id, season_id) — re-running on a
 * fully-seeded DB simply skips. Cannoli + Cynthia overlap with the auto
 * minter; the manual rows here are the source of truth and will overwrite
 * what the auto job picked when the data disagrees (we delete the auto pins
 * for those slugs before remint to keep things clean).
 */
import { Database } from 'bun:sqlite';

interface ManualAwardBase {
  pin: string;
  /** League the award is filed against. Required for per-league awards. */
  leagueId?: string;
  /** Season the award is filed against. Required for all-leagues awards
   *  (`ash`, `red`) where leagueId is left blank. */
  season?: number;
}

interface UsernameAward extends ManualAwardBase {
  username: string;
  pokemon?: never;
  nickname?: never;
}

interface PokemonAward extends ManualAwardBase {
  pokemon: string;
  nickname?: string;
  username?: never;
}

export type ManualAward = UsernameAward | PokemonAward;

// ─── Season 9 ─────────────────────────────────────────────────────────────

export const S9_AWARDS: ManualAward[] = [
  // Garchomp = most KOs (per league, by Pokemon → recipient is owner)
  { pin: 'garchomp', leagueId: 's9-emerald', pokemon: 'Quaquaval' },
  { pin: 'garchomp', leagueId: 's9-emerald', pokemon: 'Darmanitan-Galar' }, // tie
  { pin: 'garchomp', leagueId: 's9-ruby',    pokemon: 'Gholdengo' },
  { pin: 'garchomp', leagueId: 's9-sapphire', pokemon: 'Armarouge' },

  // Clodsire = most passive KOs (per league, by Pokemon → owner)
  { pin: 'clodsire', leagueId: 's9-emerald',  pokemon: 'Toxapex' },
  { pin: 'clodsire', leagueId: 's9-ruby',     pokemon: 'Corviknight' }, // tie
  { pin: 'clodsire', leagueId: 's9-ruby',     pokemon: 'Bellibolt' },   // tie
  { pin: 'clodsire', leagueId: 's9-sapphire', pokemon: 'Torkoal' },

  // Baxcalibur = best sweep (per league, by Pokemon → owner)
  { pin: 'baxcalibur', leagueId: 's9-emerald',  pokemon: 'Quaquaval' },
  { pin: 'baxcalibur', leagueId: 's9-ruby',     pokemon: 'Scolipede' },
  { pin: 'baxcalibur', leagueId: 's9-sapphire', pokemon: 'Empoleon' },

  // Kingambit = best comeback (per league, by Pokemon → owner)
  { pin: 'kingambit', leagueId: 's9-emerald',  pokemon: 'Basculegion-M' },
  { pin: 'kingambit', leagueId: 's9-ruby',     pokemon: 'Lilligant' },
  { pin: 'kingambit', leagueId: 's9-sapphire', pokemon: 'Vanilluxe' },

  // Ash = MIP (all leagues, by coach username)
  { pin: 'ash', season: 9, username: 'bio' },

  // Cannoli = best regular-season record (per league, by coach username)
  { pin: 'cannoli', leagueId: 's9-emerald',  username: 'christina' },
  { pin: 'cannoli', leagueId: 's9-ruby',     username: 'alex' }, // "George W. Bush (ALEX)" — alex
  { pin: 'cannoli', leagueId: 's9-sapphire', username: 'nate' },

  // Cynthia = best win streak (per league, by coach username)
  { pin: 'cynthia', leagueId: 's9-emerald',  username: 'christina' },
  { pin: 'cynthia', leagueId: 's9-ruby',     username: 'michael' },
  { pin: 'cynthia', leagueId: 's9-sapphire', username: 'dylan' },

  // best-draft = "Emerald/Ruby/Sapphire" award, beginning-of-season
  { pin: 'best-draft', leagueId: 's9-emerald',  username: 'christina' },
  { pin: 'best-draft', leagueId: 's9-ruby',     username: 'taylor' },   // Mahogany Miltanks
  { pin: 'best-draft', leagueId: 's9-sapphire', username: 'beef' },     // Goldenrod Gangsters — orphan team in seed

  // dragapult = MVP (per league, by Pokemon → owner)
  { pin: 'dragapult', leagueId: 's9-emerald',  pokemon: 'Quaquaval' },
  { pin: 'dragapult', leagueId: 's9-ruby',     pokemon: 'Blastoise' },
  { pin: 'dragapult', leagueId: 's9-sapphire', pokemon: 'Armarouge' },

  // charizard = Low Tier MVP (per league, by Pokemon → owner)
  { pin: 'charizard', leagueId: 's9-emerald',  pokemon: 'Cursola' },
  { pin: 'charizard', leagueId: 's9-ruby',     pokemon: 'Frosmoth' },
  { pin: 'charizard', leagueId: 's9-sapphire', pokemon: 'Marowak-Alola' },

  // florges = Best Tera Captain (per league, by Pokemon → owner)
  { pin: 'florges', leagueId: 's9-emerald',  pokemon: 'Cursola' },
  { pin: 'florges', leagueId: 's9-ruby',     pokemon: 'Blastoise' },
  { pin: 'florges', leagueId: 's9-sapphire', pokemon: 'Toxtricity' },

  // rotom = Best Nickname (per league, by Pokemon → owner; nickname → metadata)
  { pin: 'rotom', leagueId: 's9-emerald',  pokemon: 'Toxapex',    nickname: 'Y u hate me Pat?' },
  { pin: 'rotom', leagueId: 's9-ruby',     pokemon: 'Annihilape', nickname: 'Furious George' },
  { pin: 'rotom', leagueId: 's9-sapphire', pokemon: 'Tinkaton',   nickname: 'CalmReasonablePerson' },

  // pikachu = Best Mascot (per league, by Pokemon → owner)
  { pin: 'pikachu', leagueId: 's9-emerald',  pokemon: 'Dedenne' },
  { pin: 'pikachu', leagueId: 's9-ruby',     pokemon: 'Pikachu' },
  { pin: 'pikachu', leagueId: 's9-sapphire', pokemon: 'Gabite' },

  // red = Best New Coach (all leagues, by coach username)
  { pin: 'red', season: 9, username: 'christina' },
];

// ─── Season 10 ────────────────────────────────────────────────────────────

export const S10_AWARDS: ManualAward[] = [
  // Garchomp
  { pin: 'garchomp', leagueId: 'emerald',  pokemon: 'Dragapult' },
  { pin: 'garchomp', leagueId: 'ruby',     pokemon: 'Mega Swampert' },
  { pin: 'garchomp', leagueId: 'sapphire', pokemon: 'Mega Blastoise' },

  // (No clodsire in S10 — the award only appeared in S9.)

  // Baxcalibur
  { pin: 'baxcalibur', leagueId: 'emerald',  pokemon: 'Comfey' },
  { pin: 'baxcalibur', leagueId: 'ruby',     pokemon: 'Rillaboom' },
  { pin: 'baxcalibur', leagueId: 'sapphire', pokemon: 'Porygon2' },

  // Kingambit
  { pin: 'kingambit', leagueId: 'emerald',  pokemon: 'Mega Blastoise' },
  { pin: 'kingambit', leagueId: 'ruby',     pokemon: 'Ribombee' },
  { pin: 'kingambit', leagueId: 'sapphire', pokemon: 'Kingambit' },

  // Ash (all-leagues)
  { pin: 'ash', season: 10, username: 'landon' },

  // Cannoli
  { pin: 'cannoli', leagueId: 'emerald',  username: 'gabe' },
  { pin: 'cannoli', leagueId: 'ruby',     username: 'jack' },
  { pin: 'cannoli', leagueId: 'sapphire', username: 'liam' },

  // Cynthia
  { pin: 'cynthia', leagueId: 'emerald',  username: 'gabe' },
  { pin: 'cynthia', leagueId: 'ruby',     username: 'jack' },  // tie
  { pin: 'cynthia', leagueId: 'ruby',     username: 'dante' }, // tie
  { pin: 'cynthia', leagueId: 'sapphire', username: 'ak' },

  // best-draft
  { pin: 'best-draft', leagueId: 'emerald',  username: 'robot' },
  { pin: 'best-draft', leagueId: 'ruby',     username: 'michael' },
  { pin: 'best-draft', leagueId: 'sapphire', username: 'garrett' },

  // dragapult MVP
  { pin: 'dragapult', leagueId: 'emerald',  pokemon: 'Slowking' },
  { pin: 'dragapult', leagueId: 'ruby',     pokemon: 'Rillaboom' },
  { pin: 'dragapult', leagueId: 'sapphire', pokemon: 'Cinderace' },

  // charizard Low Tier MVP
  { pin: 'charizard', leagueId: 'emerald',  pokemon: 'Muk-Alola' },
  { pin: 'charizard', leagueId: 'ruby',     pokemon: 'Indeedee-F' },
  { pin: 'charizard', leagueId: 'sapphire', pokemon: 'Porygon' },

  // florges Best Tera Captain
  { pin: 'florges', leagueId: 'emerald',  pokemon: 'Muk' },
  { pin: 'florges', leagueId: 'ruby',     pokemon: 'Pikachu' },
  { pin: 'florges', leagueId: 'sapphire', pokemon: 'Drednaw' },

  // rotom Best Nickname
  { pin: 'rotom', leagueId: 'emerald',  pokemon: 'Mega Swampert',  nickname: '(Kingdom) Come Deliverer' },
  { pin: 'rotom', leagueId: 'ruby',     pokemon: 'Klefki',         nickname: 'Alicia Keys' },
  { pin: 'rotom', leagueId: 'sapphire', pokemon: 'Marowak-Alola',  nickname: 'Darth Maul' },

  // pikachu Best Mascot
  { pin: 'pikachu', leagueId: 'emerald',  pokemon: 'Magikarp' },
  { pin: 'pikachu', leagueId: 'ruby',     pokemon: 'Pikachu' },
  { pin: 'pikachu', leagueId: 'sapphire', pokemon: 'Porygon' },

  // red Best New Coach (all-leagues)
  { pin: 'red', season: 10, username: 'gabe' },
];

// ─── Minter ───────────────────────────────────────────────────────────────

export interface ManualMintSummary {
  inserted: number;
  skipped: number;
  unresolved: { award: ManualAward; reason: string }[];
}

/**
 * Mint a manual-awards list against the live DB.
 *
 * Resolution per row:
 *   - `username` form: look up users by username (case-insensitive), file
 *     pin against (userId, pinDefId, seasonId) with metadata { leagueId? }.
 *   - `pokemon` form: find the team in `leagueId` whose roster contains the
 *     given pokemon name (exact-match — DB stores Mega prefix and form
 *     suffix literally), then file pin against the team's owner. Skipped
 *     with a warning when the team has no userId (orphan import).
 *
 * Idempotent: INSERT OR IGNORE against the (user_id, pin_def_id, season_id)
 * unique index. Re-running on a seeded DB is a no-op for existing rows.
 *
 * Before minting, this clears the auto-award rows for the slugs that overlap
 * (cannoli, cynthia, garchomp) for the relevant season — the manual list is
 * the source of truth, so we want the auto job's guesses out of the way.
 * Scoped by season_id + awarded_by IS NULL so admin-minted pins survive.
 */
export function mintManualPins(
  sqlite: Database,
  season: number,
  awards: ManualAward[],
  awardedBy: number | null = null,
): ManualMintSummary {
  const summary: ManualMintSummary = { inserted: 0, skipped: 0, unresolved: [] };

  const seasonRow = sqlite.prepare(
    `SELECT id FROM seasons WHERE season_number = ?`,
  ).get(season) as { id: number } | undefined;
  if (!seasonRow) {
    summary.unresolved.push({ award: { pin: '__season__' } as ManualAward, reason: `season ${season} not found` });
    return summary;
  }
  const seasonId = seasonRow.id;

  const findUser = sqlite.prepare(
    `SELECT id, username FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`,
  );
  const findRosterTeam = sqlite.prepare(
    `SELECT t.id AS team_id, t.user_id, t.team_name, r.nickname AS roster_nickname
       FROM rosters r
       JOIN teams t ON t.id = r.team_id
      WHERE t.league_id = ? AND r.pokemon_name = ?
      ORDER BY (CASE WHEN t.user_id IS NULL THEN 1 ELSE 0 END), r.id
      LIMIT 1`,
  );
  const ensureDef = sqlite.prepare(
    `SELECT id FROM pin_definitions WHERE id = ?`,
  );
  const insertPin = sqlite.prepare(
    `INSERT OR IGNORE INTO pins (user_id, pin_def_id, season_id, awarded_by, metadata)
     VALUES (?, ?, ?, ?, ?)`,
  );

  // Collect the distinct leagues referenced by overlap-slug awards. We'll do
  // a league-scoped clear (by metadata.teamId, matching auto-award.ts and
  // archive-mint.ts) so a bulk-mint for one league can't delete sibling
  // leagues' auto-pins that share the same season_id.
  const overlap = new Set(['cannoli', 'cynthia', 'garchomp']);
  const overlapLeagues = new Set<string>(
    awards
      .filter(a => overlap.has(a.pin) && a.leagueId)
      .map(a => a.leagueId as string),
  );

  const clearOverlapByLeague = sqlite.prepare(
    `DELETE FROM pins
      WHERE pin_def_id IN ('cannoli', 'cynthia', 'garchomp')
        AND season_id = ?
        AND awarded_by IS NULL
        AND json_extract(metadata, '$.teamId') IN (
          SELECT id FROM teams WHERE league_id = ?
        )`,
  );

  // Wrap the clear + all inserts in a single transaction so a crash between
  // them cannot leave the season's pins in a half-deleted state.
  sqlite.transaction(() => {
    // Clear overlapping auto-pins per league so the manual list takes over.
    // Only touches awarded_by IS NULL (auto rows). Scoped by metadata.teamId
    // to match the pattern used by runAutoAwards and mintArchivePins — avoids
    // stomping on sibling-league auto-pins for coaches in multiple leagues.
    for (const leagueId of overlapLeagues) {
      clearOverlapByLeague.run(seasonId, leagueId);
    }

    for (const a of awards) {
      const def = ensureDef.get(a.pin) as { id: string } | undefined;
      if (!def) {
        summary.unresolved.push({ award: a, reason: `pin definition '${a.pin}' missing` });
        continue;
      }

      let userId: number | null = null;
      const metadata: Record<string, unknown> = {};
      if (a.leagueId) metadata.leagueId = a.leagueId;

      if ('username' in a && a.username) {
        const u = findUser.get(a.username) as { id: number; username: string } | undefined;
        if (!u) {
          summary.unresolved.push({ award: a, reason: `username '${a.username}' not found` });
          continue;
        }
        userId = u.id;
      } else if ('pokemon' in a && a.pokemon) {
        if (!a.leagueId) {
          summary.unresolved.push({ award: a, reason: `pokemon-form award missing leagueId` });
          continue;
        }
        const row = findRosterTeam.get(a.leagueId, a.pokemon) as
          | { team_id: string; user_id: number | null; team_name: string; roster_nickname: string | null }
          | undefined;
        if (!row) {
          summary.unresolved.push({ award: a, reason: `pokemon '${a.pokemon}' not on any roster in '${a.leagueId}'` });
          continue;
        }
        if (!row.user_id) {
          summary.unresolved.push({ award: a, reason: `team '${row.team_name}' (${row.team_id}) has no userId — orphan` });
          continue;
        }
        userId = row.user_id;
        metadata.pokemon = a.pokemon;
        metadata.teamId = row.team_id;
        if (a.nickname) metadata.nickname = a.nickname;
      } else {
        summary.unresolved.push({ award: a, reason: `award has neither username nor pokemon` });
        continue;
      }

      const res = insertPin.run(
        userId,
        a.pin,
        seasonId,
        awardedBy,
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      );
      const changed = (res as unknown as { changes?: number }).changes ?? 0;
      if (changed > 0) summary.inserted++;
      else summary.skipped++;
    }
  })();

  return summary;
}
