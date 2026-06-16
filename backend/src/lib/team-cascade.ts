/**
 * Shared team-deletion + draft-order reconciliation helpers.
 *
 * The team-delete logic used to live inline in the `DELETE /api/teams/:teamId`
 * handler. It's been lifted here so the new membership routes (remove / move a
 * coach) reconcile exactly the same set of tables — and so the two gaps the
 * inline version had are fixed once, for every caller:
 *   1. it never cleared the team's `draftQueue` rows (auto-pick prefs), and
 *   2. it never removed the team id from its league's `draftOrder` JSON.
 * In the predraft / draft-not-started window those are the only team-scoped
 * rows that can exist, and a stale `draftOrder` breaks the draft-start
 * precondition in `routes/admin/leagues.ts` (`order.length === teams.length`).
 *
 * It also clears `scrims` / `scrim_pokemon`, which the inline version omitted —
 * those carry NOT NULL FKs to `teams`, so with `PRAGMA foreign_keys = ON` a
 * delete of a team that ever scrimmed would otherwise throw.
 *
 * None of these functions open their own transaction or write an activity-log
 * entry — callers wrap them in `tx()` and log as appropriate.
 */
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

/** Drop a team id from a league's `draftOrder` JSON array (no-op if absent). */
export function removeFromDraftOrder(leagueId: string, teamId: string): void {
  const row = db.select({ draftOrder: schema.leagues.draftOrder })
    .from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!row?.draftOrder) return;
  let order: unknown;
  try { order = JSON.parse(row.draftOrder); } catch { return; }
  if (!Array.isArray(order) || !order.includes(teamId)) return;
  const next = (order as string[]).filter(id => id !== teamId);
  db.update(schema.leagues).set({ draftOrder: JSON.stringify(next) })
    .where(eq(schema.leagues.id, leagueId)).run();
}

/** Append a team id to a league's `draftOrder` JSON array. No-op when the league
 *  has no order set yet (admin sets it later) or the id is already present. */
export function appendToDraftOrder(leagueId: string, teamId: string): void {
  const row = db.select({ draftOrder: schema.leagues.draftOrder })
    .from(schema.leagues).where(eq(schema.leagues.id, leagueId)).get();
  if (!row?.draftOrder) return;
  let order: unknown;
  try { order = JSON.parse(row.draftOrder); } catch { return; }
  if (!Array.isArray(order) || order.includes(teamId)) return;
  const next = [...(order as string[]), teamId];
  db.update(schema.leagues).set({ draftOrder: JSON.stringify(next) })
    .where(eq(schema.leagues.id, leagueId)).run();
}

/**
 * Delete a team and every row scoped to it, and reconcile its league's
 * `draftOrder`. Must be called inside a `tx()`.
 */
export function deleteTeamCascade(teamId: string, leagueId: string): void {
  // Team-scoped child rows.
  db.delete(schema.rosters).where(eq(schema.rosters.teamId, teamId)).run();
  db.delete(schema.matchPokemon).where(eq(schema.matchPokemon.teamId, teamId)).run();
  db.delete(schema.draftPicks).where(eq(schema.draftPicks.teamId, teamId)).run();
  db.delete(schema.draftQueue).where(eq(schema.draftQueue.teamId, teamId)).run();
  db.delete(schema.matchReadyLog).where(eq(schema.matchReadyLog.teamId, teamId)).run();
  db.delete(schema.playerAvailability).where(eq(schema.playerAvailability.teamId, teamId)).run();
  db.delete(schema.byeWeeks).where(eq(schema.byeWeeks.teamId, teamId)).run();
  db.delete(schema.tradeBlockListings).where(eq(schema.tradeBlockListings.teamId, teamId)).run();

  // Scrims reference teams via NOT NULL FKs — clear this team's own scrim stats,
  // then delete every scrim it played in (cascade removes the opponent's rows).
  db.delete(schema.scrimPokemon).where(eq(schema.scrimPokemon.teamId, teamId)).run();
  db.delete(schema.scrims)
    .where(sql`${schema.scrims.homeTeamId} = ${teamId} OR ${schema.scrims.awayTeamId} = ${teamId}`).run();

  // Matches / transactions / trades mentioning this team. Dropping shared
  // matches removes them from the opponent's record too — necessary for a clean
  // delete (mirrors the original inline behaviour).
  db.delete(schema.matches)
    .where(sql`${schema.matches.homeTeamId} = ${teamId} OR ${schema.matches.awayTeamId} = ${teamId}`).run();
  db.delete(schema.transactions)
    .where(sql`${schema.transactions.teamId} = ${teamId} OR ${schema.transactions.otherTeamId} = ${teamId}`).run();
  db.delete(schema.trades)
    .where(sql`${schema.trades.proposerId} = ${teamId} OR ${schema.trades.recipientId} = ${teamId}`).run();

  // Reconcile the league-level draft order, then drop the team row itself.
  removeFromDraftOrder(leagueId, teamId);
  db.delete(schema.teams).where(eq(schema.teams.id, teamId)).run();
}
