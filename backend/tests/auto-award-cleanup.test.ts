/**
 * Integration test for Fix 4: at the start of the `season-end` branch of
 * runAutoAwards, prior auto-awarded (awarded_by IS NULL) garchomp/cannoli/
 * cynthia pins for users in this league/season are deleted so a re-run
 * after a data correction picks new winners cleanly. Admin-minted pins
 * (awarded_by IS NOT NULL) are preserved.
 *
 * Strategy: insert a fixture league + 3 teams (X, Y, Z) inside a tx, plus a
 * stale auto pin for X and an admin-minted pin for Z, then rig matches so Y
 * wins the season. Run runAutoAwards, then assert:
 *   - X's stale auto pin is gone
 *   - Y has a fresh auto pin
 *   - Z's admin-minted pin survives
 *
 * ROLLBACK at the end so the dev DB is unchanged.
 */
import { describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { db, schema, sqlite } from '../src/db';
import { runAutoAwards } from '../src/lib/pins/auto-award';
import { mintManualPins } from '../src/lib/pins/awards-data';

const PFX = 'tfix4-';

function pickHost(): { seasonId: number; userIds: number[] } | null {
  const seasons = db.select().from(schema.seasons).limit(1).all();
  if (seasons.length === 0) return null;
  const seasonId = seasons[0].id;
  // Need 3 users who don't already hold a cannoli pin for this season —
  // the test inserts cannoli pins by hand and would hit the unique
  // (user_id, pin_def_id, season_id) index otherwise. Any user with a
  // pre-seeded pin (e.g. the Discord-announced manual awards) gets
  // filtered out.
  const taken = new Set(
    db.select({ userId: schema.pins.userId })
      .from(schema.pins)
      .where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, seasonId),
      ))
      .all()
      .map(r => r.userId),
  );
  const users = db.select().from(schema.users).all().filter(u => !taken.has(u.id));
  if (users.length < 3) return null;
  return { seasonId, userIds: users.slice(0, 3).map(u => u.id) };
}

describe('runAutoAwards season-end re-run cleanup (Fix 4)', () => {
  const host = pickHost();
  if (!host) {
    test.skip('seeded DB lacks a season + 3 users — skipping', () => {});
    return;
  }

  test('re-run replaces stale auto pins, preserves admin-minted pins', () => {
    sqlite.exec('BEGIN');
    try {
      const leagueId = `${PFX}lg`;
      const [userX, userY, userZ] = host.userIds;

      // Fresh fixture league scoped to the existing season.
      db.insert(schema.leagues).values({
        id: leagueId, name: 'Test Cleanup League', color: '#888888',
        seasonId: host.seasonId, phase: 'offseason',
      }).run();

      const teamX = `${PFX}tx`, teamY = `${PFX}ty`, teamZ = `${PFX}tz`;
      db.insert(schema.teams).values([
        { id: teamX, leagueId, userId: userX, coachName: 'X', teamName: 'TX', teamAbbrev: 'TX', teamColor: '#111' },
        { id: teamY, leagueId, userId: userY, coachName: 'Y', teamName: 'TY', teamAbbrev: 'TY', teamColor: '#222' },
        { id: teamZ, leagueId, userId: userZ, coachName: 'Z', teamName: 'TZ', teamAbbrev: 'TZ', teamColor: '#333' },
      ]).run();

      // Rigged matches so Y has the best record (2-0), X is 1-1, Z is 0-2.
      // Diff also makes Y the clear cannoli winner.
      db.insert(schema.matches).values([
        { id: `${PFX}m1`, leagueId, week: 1, homeTeamId: teamY, awayTeamId: teamX, homeScore: 5, awayScore: 1, status: 'completed', phase: 'regular' },
        { id: `${PFX}m2`, leagueId, week: 2, homeTeamId: teamY, awayTeamId: teamZ, homeScore: 6, awayScore: 0, status: 'completed', phase: 'regular' },
        { id: `${PFX}m3`, leagueId, week: 3, homeTeamId: teamX, awayTeamId: teamZ, homeScore: 4, awayScore: 2, status: 'completed', phase: 'regular' },
      ]).run();

      // Pre-existing stale auto pin for X (the "old" cannoli winner).
      // metadata.teamId is set because the cleanup DELETE scopes by it.
      db.insert(schema.pins).values({
        userId: userX, pinDefId: 'cannoli', seasonId: host.seasonId,
        awardedBy: null, // <- auto
        metadata: JSON.stringify({ stale: true, teamId: teamX }),
      }).run();
      // Pre-existing admin-minted cannoli pin for Z. awardedBy is NOT NULL.
      // Use userZ as the awardedBy too — just needs a non-null user FK.
      db.insert(schema.pins).values({
        userId: userZ, pinDefId: 'cannoli', seasonId: host.seasonId,
        awardedBy: userZ,
        metadata: JSON.stringify({ admin: true }),
      }).run();

      // Sanity: pre-state has X (auto) and Z (admin) cannoli pins.
      const before = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
      )).all().filter(p => [userX, userY, userZ].includes(p.userId));
      expect(before.map(p => p.userId).sort()).toEqual([userX, userZ].sort());

      // === run season-end auto-award ===
      runAutoAwards(leagueId, { trigger: 'season-end' });

      // Post-state: X's stale auto pin is gone, Y has a fresh auto pin,
      // Z's admin-minted pin still present.
      const after = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
      )).all().filter(p => [userX, userY, userZ].includes(p.userId));

      const byUser = new Map(after.map(p => [p.userId, p]));

      // X is gone
      expect(byUser.has(userX)).toBe(false);
      // Y is the new auto winner (awardedBy IS NULL)
      expect(byUser.has(userY)).toBe(true);
      expect(byUser.get(userY)!.awardedBy).toBeNull();
      // Z's admin-minted pin survives (awardedBy IS NOT NULL)
      expect(byUser.has(userZ)).toBe(true);
      expect(byUser.get(userZ)!.awardedBy).toBe(userZ);
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });

  // Regression for the multi-league bug: a coach who plays in two leagues
  // in the same season must not have their sibling-league pin clobbered
  // when one of their leagues finalizes. Pre-fix the DELETE matched by
  // user_id, which would wipe both. Post-fix it scopes by metadata.teamId
  // so only the finalizing league's pin is replaced.
  test('cross-league: finalizing league M does not clobber a coach\'s pin from sibling league L', () => {
    sqlite.exec('BEGIN');
    try {
      const leagueL = `${PFX}lgL`;
      const leagueM = `${PFX}lgM`;
      const [userU, userV, userW] = host.userIds;

      // Two leagues in the same season. Only league M will be finalized.
      db.insert(schema.leagues).values([
        { id: leagueL, name: 'Sibling League L', color: '#aa0000', seasonId: host.seasonId, phase: 'offseason' },
        { id: leagueM, name: 'Finalizing League M', color: '#00aa00', seasonId: host.seasonId, phase: 'offseason' },
      ]).run();

      // User U coaches a team in BOTH leagues. V and W round out league M
      // so runAutoAwards has a complete bracket to score.
      const teamL = `${PFX}tL`;   // U's team in L
      const teamMu = `${PFX}tMu`; // U's team in M
      const teamMv = `${PFX}tMv`;
      const teamMw = `${PFX}tMw`;
      db.insert(schema.teams).values([
        { id: teamL,  leagueId: leagueL, userId: userU, coachName: 'U', teamName: 'UL', teamAbbrev: 'UL', teamColor: '#111' },
        { id: teamMu, leagueId: leagueM, userId: userU, coachName: 'U', teamName: 'UM', teamAbbrev: 'UM', teamColor: '#222' },
        { id: teamMv, leagueId: leagueM, userId: userV, coachName: 'V', teamName: 'VM', teamAbbrev: 'VM', teamColor: '#333' },
        { id: teamMw, leagueId: leagueM, userId: userW, coachName: 'W', teamName: 'WM', teamAbbrev: 'WM', teamColor: '#444' },
      ]).run();

      // Rigged league M matches: V wins (so V should be the new auto winner,
      // not U). U's M-scoped stale pin should still be cleared.
      db.insert(schema.matches).values([
        { id: `${PFX}xm1`, leagueId: leagueM, week: 1, homeTeamId: teamMv, awayTeamId: teamMu, homeScore: 5, awayScore: 1, status: 'completed', phase: 'regular' },
        { id: `${PFX}xm2`, leagueId: leagueM, week: 2, homeTeamId: teamMv, awayTeamId: teamMw, homeScore: 6, awayScore: 0, status: 'completed', phase: 'regular' },
        { id: `${PFX}xm3`, leagueId: leagueM, week: 3, homeTeamId: teamMu, awayTeamId: teamMw, homeScore: 4, awayScore: 2, status: 'completed', phase: 'regular' },
      ]).run();

      // Auto pin for U from league L's prior finalize. MUST SURVIVE when
      // league M finalizes. There's a UNIQUE(user_id, pin_def_id, season_id)
      // index so we can't also stage a separate M-scoped row for U — but
      // the bug is precisely that the pre-fix DELETE matched by user_id
      // and would wipe THIS row, never mind which league it came from.
      db.insert(schema.pins).values({
        userId: userU, pinDefId: 'cannoli', seasonId: host.seasonId,
        awardedBy: null,
        metadata: JSON.stringify({ teamId: teamL, source: 'L' }),
      }).run();

      // === finalize league M only ===
      runAutoAwards(leagueM, { trigger: 'season-end' });

      const userUPins = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
        eq(schema.pins.userId, userU),
      )).all();

      // U's league-L pin must still be there (post-fix). Pre-fix this row
      // would have been deleted because the DELETE scoped by user_id and
      // U is a coach in league M.
      expect(userUPins.length).toBe(1);
      const surviving = JSON.parse(userUPins[0].metadata as string) as { teamId?: string; source?: string };
      expect(surviving.teamId).toBe(teamL);
      expect(surviving.source).toBe('L');

      // V is the new league-M auto winner.
      const userVPins = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
        eq(schema.pins.userId, userV),
      )).all();
      expect(userVPins.length).toBe(1);
      expect(userVPins[0].awardedBy).toBeNull();
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});

// ─── mintManualPins league-scope isolation ────────────────────────────────
//
// Regression guard for the pre-fix bug: mintManualPins cleared overlap auto-pins
// (cannoli/cynthia/garchomp) scoped only by season_id, so bulk-minting league A's
// manual awards would also delete sibling league B's auto-pins in the same season.
// Post-fix the clear scopes by metadata.teamId IN (teams of the target league).

describe('mintManualPins — sibling league auto-pin isolation', () => {
  const host = pickHost();
  if (!host) {
    test.skip('seeded DB lacks a season + 3 users — skipping', () => {});
    return;
  }

  test('minting league A manual pins does not delete league B auto-pins', () => {
    sqlite.exec('BEGIN');
    try {
      const PFX2 = 'tmmp-';
      const [userA, userB] = host.userIds;

      // Two leagues in the same season.
      const leagueA = `${PFX2}lgA`;
      const leagueB = `${PFX2}lgB`;
      db.insert(schema.leagues).values([
        { id: leagueA, name: 'Manual Mint League A', color: '#aa0000', seasonId: host.seasonId, phase: 'offseason' },
        { id: leagueB, name: 'Sibling League B', color: '#0000aa', seasonId: host.seasonId, phase: 'offseason' },
      ]).run();

      const teamA = `${PFX2}tA`;
      const teamB = `${PFX2}tB`;
      db.insert(schema.teams).values([
        { id: teamA, leagueId: leagueA, userId: userA, coachName: 'A', teamName: 'TA', teamAbbrev: 'TA', teamColor: '#111' },
        { id: teamB, leagueId: leagueB, userId: userB, coachName: 'B', teamName: 'TB', teamAbbrev: 'TB', teamColor: '#222' },
      ]).run();

      // Auto-pin for userB from league B. This is the pin that MUST survive.
      db.insert(schema.pins).values({
        userId: userB, pinDefId: 'cannoli', seasonId: host.seasonId,
        awardedBy: null,
        metadata: JSON.stringify({ teamId: teamB, source: 'leagueB-auto' }),
      }).run();

      // Sanity: userB's pin exists before the mint.
      const before = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
        eq(schema.pins.userId, userB),
      )).all();
      expect(before.length).toBe(1);

      // Look up the season_number for mintManualPins (which takes season number,
      // not the internal seasonId).
      const seasonRow = db.select().from(schema.seasons)
        .where(eq(schema.seasons.id, host.seasonId)).get();
      if (!seasonRow) throw new Error('season row not found');

      const userARow = db.select({ username: schema.users.username })
        .from(schema.users).where(eq(schema.users.id, userA)).get();
      if (!userARow) throw new Error('userA not found');

      // Mint league A's manual cannoli award. The pre-fix code would delete
      // ALL cannoli auto-pins for this season_id (including userB's leagueB pin).
      // Post-fix it only deletes within leagueA's teams.
      mintManualPins(
        sqlite,
        seasonRow.seasonNumber,
        [{ pin: 'cannoli', leagueId: leagueA, username: userARow.username }],
        null,
      );

      // userB's league B auto-pin MUST still be present (post-fix guarantee).
      const after = db.select().from(schema.pins).where(and(
        eq(schema.pins.pinDefId, 'cannoli'),
        eq(schema.pins.seasonId, host.seasonId),
        eq(schema.pins.userId, userB),
      )).all();
      expect(after.length).toBe(1);
      const meta = JSON.parse(after[0].metadata as string) as { source?: string };
      expect(meta.source).toBe('leagueB-auto');
    } finally {
      sqlite.exec('ROLLBACK');
    }
  });
});
