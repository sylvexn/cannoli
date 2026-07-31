/**
 * PS Monitor Bot — INVITE-flow lifecycle (Showdown team-pick fix).
 *
 * The chat plugin no longer force-starts a battle with the player's stale
 * `battleSettings.team`. It now creates the battle room immediately with BOTH
 * player slots empty + invited, so each player picks a team in their native
 * Showdown team-picker and accepts. The battle only STARTS once both accept.
 *
 * Consequences exercised here (against the real DB, driving the bot's actual
 * private handlers via handleMessageForTest — no socket):
 *   - cannoli-battle-created PM records psRoomId but does NOT flip in_progress
 *     and does NOT clear the ready-timeout (deferred to battle-start).
 *   - once BOTH |player| lines arrive on the room, the match transitions to
 *     in_progress with startedAt stamped (this is battle-start).
 *   - the transition is idempotent (a duplicate |player| line can't re-flip).
 *   - a finalized match is not re-linked / re-started.
 *   - cancelBattle() emits |/cannoli-cancel and drops the monitor entry.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import {
  handleMessageForTest,
  getMonitoredBattlesForTest,
  getSendQueueForTest,
  cancelBattle,
} from '../src/lib/ps-bot';

// Fixture: league(regular), 2 teams, owning users, 1 ready match

const tag = `botinvite-${Date.now()}`;
const leagueId = `${tag}-lg`;
const homeTid = `${tag}-home`;
const awayTid = `${tag}-away`;
const matchId = `${tag}-w1m1`;
const ROOM = `battle-gen9natdexdraft-${Date.now() % 1_000_000}`;
let seasonId: number;
const userIds: number[] = [];

function mkUser(name: string): number {
  const u = db.insert(schema.users).values({
    username: `${tag}-${name}`, passwordHash: 'x', role: 'user', mustChangePassword: false, active: true,
  }).returning().get();
  userIds.push(u.id);
  return u.id;
}

const season = db.insert(schema.seasons).values({
  seasonNumber: 7000 + (Date.now() % 900), pointCap: 110, teraCaptainSlots: 2, archived: false,
}).returning().get();
seasonId = season.id;

db.insert(schema.leagues).values({
  id: leagueId, name: 'Bot Invite Fixture', color: '#abcdef', seasonId,
  phase: 'regular', currentWeek: 1, draftOrder: JSON.stringify([homeTid, awayTid]),
}).run();

const homeUid = mkUser('home');
const awayUid = mkUser('away');
db.insert(schema.teams).values({ id: homeTid, leagueId, userId: homeUid, coachName: 'H', teamName: 'Home', teamAbbrev: 'HOM' }).run();
db.insert(schema.teams).values({ id: awayTid, leagueId, userId: awayUid, coachName: 'A', teamName: 'Away', teamAbbrev: 'AWY' }).run();

const homeUserid = `${tag}home`.replace(/[^a-z0-9]/g, ''); // toUserid lowercases + strips
const awayUserid = `${tag}away`.replace(/[^a-z0-9]/g, '');

function resetMatch(status: 'ready' | 'scheduled' | 'completed' = 'ready') {
  db.update(schema.matches)
    .set({ status, psRoomId: null, startedAt: null, readyHome: true, readyAway: true })
    .where(eq(schema.matches.id, matchId)).run();
  getMonitoredBattlesForTest().delete(ROOM);
  getSendQueueForTest().splice(0);
}

db.insert(schema.matches).values({
  id: matchId, leagueId, week: 1, homeTeamId: homeTid, awayTeamId: awayTid,
  status: 'ready', readyHome: true, readyAway: true,
}).run();

beforeEach(() => resetMatch('ready'));

afterAll(() => {
  getMonitoredBattlesForTest().delete(ROOM);
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.matchId, matchId)).run();
  db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.matchId, matchId)).run();
  db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, leagueId)).run();
  db.delete(schema.matches).where(eq(schema.matches.leagueId, leagueId)).run();
  db.delete(schema.teams).where(eq(schema.teams.leagueId, leagueId)).run();
  for (const id of userIds) db.delete(schema.users).where(eq(schema.users.id, id)).run();
  db.delete(schema.leagues).where(eq(schema.leagues.id, leagueId)).run();
  db.delete(schema.seasons).where(eq(schema.seasons.id, seasonId)).run();
});

// The PM the chat plugin sends right after creating the (not-yet-started) room.
function createdPm(roomId: string, mId?: string) {
  const body = `cannoli-battle-created|${roomId}|${homeUserid}|${awayUserid}|gen9natdexdraft${mId ? `|${mId}` : ''}`;
  // |pm|SENDER|RECEIVER|MESSAGE — sender must be the ~Cannoli system identity.
  return `|pm|~Cannoli|CannoliBot|${body}`;
}

describe('cannoli-battle-created PM (invite created, battle NOT started)', () => {
  test('records psRoomId + links match but leaves status pre-start (no in_progress)', () => {
    handleMessageForTest(createdPm(ROOM, matchId));

    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    // psRoomId is stamped so the FE can show "pick your team in Showdown".
    expect(m.psRoomId).toBe(ROOM);
    // Battle hasn't started — status stays 'ready', startedAt unset.
    expect(m.status).toBe('ready');
    expect(m.startedAt).toBeNull();

    // The monitor entry is linked to the match (deterministic link).
    const entry = getMonitoredBattlesForTest().get(ROOM);
    expect(entry?.matchId).toBe(matchId);
    expect(entry?.isOfficial).toBe(true);

    // The bot joins the room.
    expect(getSendQueueForTest().some(c => c === `|/join ${ROOM}`)).toBe(true);
  });

  test('does NOT re-link a finalized match', () => {
    resetMatch('completed');
    handleMessageForTest(createdPm(ROOM, matchId));

    const entry = getMonitoredBattlesForTest().get(ROOM);
    // Room is still monitored (joined) but not linked to the completed match.
    expect(entry?.matchId).toBeNull();
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.status).toBe('completed');
    expect(m.psRoomId).toBeNull();
  });
});

describe('battle-start transition (both players accept the invite)', () => {
  test('both |player| lines flip the linked match to in_progress', () => {
    handleMessageForTest(createdPm(ROOM, matchId));
    // Pre-condition from the PM step.
    expect(db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!.status).toBe('ready');

    // Player 1 accepts (picks a team, joins) — battle still not fully started.
    handleMessageForTest(`>${ROOM}\n|player|p1|${homeUserid}|1|`);
    let m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.status).toBe('ready'); // only one player present

    // Player 2 accepts → battle starts → match goes in_progress.
    handleMessageForTest(`>${ROOM}\n|player|p2|${awayUserid}|2|`);
    m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.status).toBe('in_progress');
    expect(m.startedAt).not.toBeNull();
    expect(m.psRoomId).toBe(ROOM);
  });

  test('a second |player| line does not re-flip an already in_progress match', () => {
    handleMessageForTest(createdPm(ROOM, matchId));
    handleMessageForTest(`>${ROOM}\n|player|p1|${homeUserid}|1|`);
    handleMessageForTest(`>${ROOM}\n|player|p2|${awayUserid}|2|`);
    const startedAt = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!.startedAt;

    // A duplicate / late |player| line must be a no-op (idempotent transition).
    handleMessageForTest(`>${ROOM}\n|player|p1|${homeUserid}|1|`);
    const m = db.select().from(schema.matches).where(eq(schema.matches.id, matchId)).get()!;
    expect(m.status).toBe('in_progress');
    expect(m.startedAt).toBe(startedAt); // unchanged
  });

  test('exactly one match_started activity-log row is written', () => {
    db.delete(schema.activityLog).where(eq(schema.activityLog.leagueId, leagueId)).run();
    handleMessageForTest(createdPm(ROOM, matchId));
    handleMessageForTest(`>${ROOM}\n|player|p1|${homeUserid}|1|`);
    handleMessageForTest(`>${ROOM}\n|player|p2|${awayUserid}|2|`);
    handleMessageForTest(`>${ROOM}\n|player|p1|${homeUserid}|1|`); // dup

    const started = db.select().from(schema.activityLog)
      .where(eq(schema.activityLog.leagueId, leagueId)).all()
      .filter(l => l.type === 'match_started' && String(l.metadata).includes(matchId));
    expect(started.length).toBe(1);
  });
});

describe('cancelBattle — tears down a pending invite room', () => {
  test('emits |/cannoli-cancel and drops the monitor entry', () => {
    handleMessageForTest(createdPm(ROOM, matchId));
    expect(getMonitoredBattlesForTest().has(ROOM)).toBe(true);
    getSendQueueForTest().splice(0);

    cancelBattle(ROOM);

    expect(getSendQueueForTest().some(c => c === `|/cannoli-cancel ${ROOM}`)).toBe(true);
    expect(getMonitoredBattlesForTest().has(ROOM)).toBe(false);
  });

  test('cancelBattle for an unknown room is a no-op (no throw, command still queued)', () => {
    getSendQueueForTest().splice(0);
    expect(() => cancelBattle('battle-gen9natdexdraft-doesnotexist')).not.toThrow();
    expect(getSendQueueForTest().some(c => c.startsWith('|/cannoli-cancel '))).toBe(true);
  });
});
