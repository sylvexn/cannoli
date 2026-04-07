/**
 * Post-draft captain gate banner. Shown on the draft board once every team
 * has finished drafting (state.status === 'completed') but the league has not
 * yet advanced to phase=regular because some teams haven't locked captains.
 *
 * For the active user's team: shows a primary CTA to their team profile.
 * For spectators/staff: shows aggregate progress (X / N teams locked).
 */
import { Link } from 'react-router-dom';
import { Crown, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { Player } from '@/lib/types';
import { cn } from '@/lib/utils';

interface DraftCaptainGateProps {
  /** All teams in this league. */
  players: Player[];
  /** Active user's team id (null if spectator). */
  userTeamId: string | null;
  /** League id, used to build the team-profile link. */
  leagueId: string;
  /** Configured captain count per team — surfaced in copy. */
  teraCaptainSlots: number;
}

export function DraftCaptainGate({ players, userTeamId, leagueId, teraCaptainSlots }: DraftCaptainGateProps) {
  const total = players.length;
  const locked = players.filter(p => p.captainsLocked).length;
  const allLocked = locked === total && total > 0;
  const userTeam = userTeamId ? players.find(p => p.id === userTeamId) ?? null : null;
  const userLocked = !!userTeam?.captainsLocked;

  // Once everyone is locked the parent should have moved on to phase=regular,
  // but render nothing as a defensive belt-and-suspenders.
  if (allLocked) return null;

  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 mb-1.5 shrink-0',
      'border-pink/30 bg-pink/5',
    )}>
      <div className="flex items-center gap-3">
        <Crown size={18} className="text-pink shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono font-bold uppercase tracking-wider text-pink">
            Draft Complete — Designate Captains
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {userTeam && !userLocked ? (
              <>Lock in your {teraCaptainSlots} tera captain{teraCaptainSlots === 1 ? '' : 's'} on your team page to advance the league to regular season.</>
            ) : userTeam && userLocked ? (
              <>You're locked in. Waiting on the rest of the league.</>
            ) : (
              <>Each team must lock {teraCaptainSlots} tera captain{teraCaptainSlots === 1 ? '' : 's'} before regular play begins.</>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
            <CheckCircle2 size={13} className={locked === total ? 'text-win' : 'text-text-muted/50'} />
            <span className="text-text-secondary">
              {locked}<span className="text-text-muted">/{total}</span>
            </span>
            <span className="text-text-muted text-[10px] uppercase tracking-wider">locked</span>
          </div>
          {userTeam && !userLocked && (
            <Link
              to={`/league/${leagueId}/teams/${userTeam.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-pink text-white text-xs font-bold uppercase tracking-wider hover:bg-pink/90 transition-colors"
            >
              Lock Captains
              <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
