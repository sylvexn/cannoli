/**
 * Playoff bracket writer + draft lifecycle (publish / unpublish).
 *
 * `writePlayoffBracket` is the ONE place bracket match rows are created. Both
 * the legacy `POST /api/leagues/:id/playoffs/generate` and the draft publish go
 * through it. Drafts themselves live in `playoff_drafts` and never touch
 * `matches`, so auto-forfeit / arena / deadlines / public readers cannot see an
 * unapproved bracket.
 */
import { db, schema } from '../db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { tx } from './tx';
import { buildPlayoffMatchups, type PlayoffMatchup } from './playoff-advance';
import { extendWeekDatesForPlayoffs, scheduleDeadline } from './deadline';
import { computeStandings } from './standings';
import { notifyUser } from './notifications/notify';

export const BRACKET_SIZES = [2, 4, 6, 8];

type Row = typeof schema.matches.$inferSelect;
export interface PlayoffFail { status: number; error: string; code: string }
const fail = (status: number, code: string, error: string): PlayoffFail => ({ status, code, error });

export function playoffMatches(leagueId: string): Row[] {
  return db.select().from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'playoffs')))
    .all();
}

/** Locked = any playoff game has a result, is live, or is on Showdown. */
export function isLocked(rows: Row[]): boolean {
  return rows.some(m => m.homeScore != null || m.awayScore != null
    || m.status === 'in_progress' || m.status === 'completed' || m.psRoomId != null);
}

export function maxRegularWeek(leagueId: string): number {
  return db.select({ max: sql<number>`MAX(week)` }).from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular')))
    .get()?.max || 0;
}

/** Delete every playoff match (+ the ready-log rows FK'd onto them). Caller owns the tx. */
export function clearPlayoffMatches(leagueId: string): void {
  const ids = playoffMatches(leagueId).map(m => m.id);
  if (ids.length > 0) db.delete(schema.matchReadyLog).where(inArray(schema.matchReadyLog.matchId, ids)).run();
  db.delete(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'playoffs'))).run();
}

/**
 * Rebuild the bracket from `seededIds` (seed 1 first). Caller owns the tx and
 * all validation. Extends weekDates over the playoff weeks, writes teams.rank
 * from `standingsIds` (the standings rank, NOT the seed).
 */
export function writePlayoffBracket(leagueId: string, seededIds: string[], standingsIds: string[]): {
  matchups: PlayoffMatchup[]; prevWeekDates: string | null;
} {
  clearPlayoffMatches(leagueId);
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get()!;
  const maxWeek = maxRegularWeek(leagueId);
  const matchups = buildPlayoffMatchups(seededIds.length, maxWeek);

  // Playoff weeks sit past the regular schedule; without dates auto-forfeit never resolves a deadline.
  const weekDates: Record<string, string> = league.weekDates ? JSON.parse(league.weekDates) : {};
  const extended = extendWeekDatesForPlayoffs(weekDates, maxWeek, matchups.map(m => m.week));
  if (extended !== weekDates) {
    db.update(schema.leagues).set({ weekDates: JSON.stringify(extended) }).where(eq(schema.leagues.id, leagueId)).run();
  }

  let n = 0;
  for (const m of matchups) {
    n++;
    db.insert(schema.matches).values({
      id: `${leagueId}-p${m.round}${n}`,
      leagueId,
      week: m.week,
      homeTeamId: m.homeSeed > 0 ? seededIds[m.homeSeed - 1] ?? null : null,
      awayTeamId: m.awaySeed > 0 ? seededIds[m.awaySeed - 1] ?? null : null,
      phase: 'playoffs',
      playoffRound: m.round,
      homeSeed: m.homeSeed || null,
      awaySeed: m.awaySeed || null,
      status: 'scheduled',
    }).run();
  }
  standingsIds.forEach((id, i) => db.update(schema.teams).set({ rank: i + 1 }).where(eq(schema.teams.id, id)).run());
  return { matchups, prevWeekDates: league.weekDates };
}

// Draft model

export function getDraft(leagueId: string) {
  return db.select().from(schema.playoffDrafts).where(eq(schema.playoffDrafts.leagueId, leagueId)).get();
}

export interface Warning { level: 'warn' | 'info'; text: string }

/** Server-side validation shared by GET (live) and publish. Warnings never block. */
export function validateSeeding(leagueId: string, order: string[], topN: number): Warning[] {
  const standings = computeStandings(leagueId);
  const rankOf = new Map(standings.map((s, i) => [s.id, i]));
  const rec = new Map(standings.map(s => [s.id, s]));
  const names = new Map(db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all()
    .map(t => [t.id, t.teamName]));
  const nm = (id: string) => names.get(id) ?? id;
  const out: Warning[] = [];
  const top = order.slice(0, topN);

  // Round-1 pairs (seed numbers, 1-based) per bracket size.
  const r1: [number, number][] = topN === 8 ? [[1, 8], [4, 5], [2, 7], [3, 6]]
    : topN === 6 ? [[3, 6], [4, 5]] : topN === 4 ? [[1, 4], [2, 3]] : [[1, 2]];
  const met = new Map<string, number>();
  for (const m of db.select().from(schema.matches)
    .where(and(eq(schema.matches.leagueId, leagueId), eq(schema.matches.phase, 'regular'))).all()) {
    if (!m.homeTeamId || !m.awayTeamId) continue;
    const k = [m.homeTeamId, m.awayTeamId].sort().join('|');
    met.set(k, (met.get(k) ?? 0) + 1);
  }
  for (const [a, b] of r1) {
    const A = top[a - 1], B = top[b - 1];
    if (A && B && (met.get([A, B].sort().join('|')) ?? 0) >= 2) {
      out.push({ level: 'warn', text: `Rematch: #${a} ${nm(A)} vs #${b} ${nm(B)} already met twice this season.` });
    }
  }
  const moved = top.filter((id, i) => rankOf.get(id) !== i).length;
  if (moved) out.push({ level: 'info', text: `${moved} seeds differ from standings order (manual seeding).` });
  top.forEach((id, i) => {
    const r = rankOf.get(id) ?? 0;
    if (r >= topN) out.push({ level: 'warn', text: `${nm(id)} finished #${r + 1}, outside the cut line.` });
    const me = rec.get(id);
    const worse = top.slice(0, i).find(o => (rec.get(o)?.wins ?? 0) < (me?.wins ?? 0));
    if (worse) out.push({ level: 'warn', text: `${nm(id)} (${me?.wins}-${me?.losses}) is seeded below ${nm(worse)} (${rec.get(worse)?.wins}-${rec.get(worse)?.losses}).` });
  });
  return out;
}

/** Validate size + order against the league's teams. Returns the cleaned order or a failure. */
export function checkDraftInput(leagueId: string, topN: unknown, order: unknown): PlayoffFail | { topN: number; order: string[] } {
  if (typeof topN !== 'number' || !BRACKET_SIZES.includes(topN)) {
    return fail(400, 'invalid_bracket_size', `topN must be one of ${BRACKET_SIZES.join(', ')}`);
  }
  const ids = new Set(computeStandings(leagueId).map(t => t.id));
  if (topN > ids.size) return fail(400, 'bracket_too_large', `Bracket size ${topN} exceeds the league's ${ids.size} teams`);
  if (!Array.isArray(order) || order.length < topN || order.length > ids.size
    || new Set(order).size !== order.length || order.some(id => !ids.has(id))) {
    return fail(400, 'invalid_seed_order', `seedOrder must list at least ${topN} distinct teams from this league`);
  }
  return { topN, order: order as string[] };
}

/** First playoff week's deadline, or null when the schedule has no dates. */
function firstWeekDeadline(leagueId: string): { week: number; deadline: string | null } {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get()!;
  const maxWeek = maxRegularWeek(leagueId);
  const week = maxWeek + 1;
  const weekDates: Record<string, string> = league.weekDates ? JSON.parse(league.weekDates) : {};
  const ext = extendWeekDatesForPlayoffs(weekDates, maxWeek, [week]);
  return { week, deadline: scheduleDeadline(ext, week, league.timezone) };
}

export const draftKey = (leagueId: string, publishedAt: string) => `playoffs-published:${leagueId}:${publishedAt}`;

export function publishDraft(leagueId: string, actor: string): PlayoffFail | { matchCount: number; notified: number } {
  const league = db.select().from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!league) return fail(404, 'not_found', 'League not found');
  const draft = getDraft(leagueId);
  if (!draft) return fail(404, 'no_draft', 'No playoff draft for this league');
  if (draft.status === 'published') return fail(409, 'already_published', 'Bracket is already published');
  if (league.phase !== 'playoffs') return fail(409, 'not_playoffs_phase', 'League must be in the playoffs phase to publish');
  if (playoffMatches(leagueId).length > 0) {
    return fail(409, 'bracket_exists', 'A bracket already exists for this league (generated outside the draft flow)');
  }
  const checked = checkDraftInput(leagueId, draft.topN, JSON.parse(draft.seedOrder));
  if ('status' in checked) return checked;
  const { week, deadline } = firstWeekDeadline(leagueId);
  if (deadline && Date.parse(deadline) < Date.now()) {
    return fail(409, 'deadline_passed', `The first playoff week (${week}) deadline has already passed - set a new week date before publishing.`);
  }

  const seeded = checked.order.slice(0, checked.topN);
  const publishedAt = new Date().toISOString();
  const { matchups } = tx(() => {
    const standingsIds = computeStandings(leagueId).map(s => s.id);
    const r = writePlayoffBracket(leagueId, seeded, standingsIds);
    db.update(schema.playoffDrafts).set({
      status: 'published', publishedAt, publishedBy: actor, updatedBy: actor,
      prePublishWeekDates: r.prevWeekDates, updatedAt: sql`(datetime('now'))`,
    }).where(eq(schema.playoffDrafts.leagueId, leagueId)).run();
    db.insert(schema.activityLog).values({
      type: 'playoffs_published', category: 'match', actor, leagueId,
      description: `Published ${seeded.length}-team playoff bracket`,
      metadata: JSON.stringify({ seedCount: seeded.length, seedings: seeded.map((teamId, i) => ({ seed: i + 1, teamId })) }),
    }).run();
    return r;
  });

  return { matchCount: matchups.length, notified: notifyBracket(leagueId, seeded, matchups, publishedAt) };
}

/** After commit: tell each seeded team's coach where they land. notifyUser never throws. */
function notifyBracket(leagueId: string, seeded: string[], matchups: PlayoffMatchup[], publishedAt: string): number {
  const teams = new Map(db.select().from(schema.teams).where(eq(schema.teams.leagueId, leagueId)).all().map(t => [t.id, t]));
  let sent = 0;
  seeded.forEach((teamId, i) => {
    const seed = i + 1;
    const team = teams.get(teamId);
    if (!team?.userId) return;
    const m = matchups.find(x => x.homeSeed === seed || x.awaySeed === seed);
    const oppSeed = m ? (m.homeSeed === seed ? m.awaySeed : m.homeSeed) : 0;
    const oppName = oppSeed > 0 ? teams.get(seeded[oppSeed - 1]!)?.teamName : null;
    const firstWeek = Math.min(...matchups.map(x => x.week));
    let body: string;
    if (m && oppName) body = `${m.round === 'f' ? 'Finals' : m.round === 'sf' ? 'Semifinal' : 'Round 1'} (week ${m.week}) vs ${oppName}.`;
    else if (m) body = `First-round bye. You enter in week ${m.week}.`;
    else body = `First-round bye. Your first game is after week ${firstWeek}.`;
    const r = notifyUser(team.userId, {
      type: 'system', category: 'matches',
      title: `Playoffs are set - you're the #${seed} seed`,
      body,
      link: `/league/${leagueId}/standings`,
      metadata: { kind: 'playoffs_published', leagueId, seed, opponentTeamId: oppSeed > 0 ? seeded[oppSeed - 1] : null, week: m?.week ?? null, round: m?.round ?? null },
      dedupeKey: draftKey(leagueId, publishedAt),
    });
    if (r === 'inserted') sent++;
  });
  return sent;
}

export function unpublishDraft(leagueId: string, actor: string): PlayoffFail | { removedNotifications: number } {
  const draft = getDraft(leagueId);
  if (!draft || draft.status !== 'published') return fail(409, 'not_published', 'Bracket is not published');
  if (isLocked(playoffMatches(leagueId))) {
    return fail(409, 'locked', 'A playoff game has already started - the bracket can no longer be unpublished.');
  }
  return tx(() => {
    clearPlayoffMatches(leagueId);
    db.update(schema.leagues).set({ weekDates: draft.prePublishWeekDates }).where(eq(schema.leagues.id, leagueId)).run();
    // Unread notifications are retracted; read ones stay (the coach already saw them).
    const removed = draft.publishedAt
      ? db.delete(schema.notifications).where(and(
        eq(schema.notifications.dedupeKey, draftKey(leagueId, draft.publishedAt)),
        isNull(schema.notifications.readAt),
      )).run().changes ?? 0
      : 0;
    db.update(schema.playoffDrafts).set({
      status: 'draft', publishedAt: null, publishedBy: null, prePublishWeekDates: null,
      updatedBy: actor, updatedAt: sql`(datetime('now'))`,
    }).where(eq(schema.playoffDrafts.leagueId, leagueId)).run();
    db.insert(schema.activityLog).values({
      type: 'playoffs_unpublished', category: 'match', actor, leagueId,
      description: 'Returned the playoff bracket to draft', metadata: JSON.stringify({ removedNotifications: removed }),
    }).run();
    return { removedNotifications: removed };
  });
}
