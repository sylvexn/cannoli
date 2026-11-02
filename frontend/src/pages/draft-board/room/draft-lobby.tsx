/**
 * Pre-draft Lobby for the Draft Room.
 *
 * MOUNT: render instead of the board while the draft has not begun, i.e.
 *   `league.season?.phase === 'predraft' ||
 *    (league.season?.phase === 'draft' && wsDraftState?.status === 'not_started')`
 * Unmount once the WS draft status leaves 'not_started' (in_progress / paused /
 * completed). Also pass `draftStarted` (status !== 'not_started') so the order
 * editor disables itself.
 *
 *   <DraftLobby
 *     teams={players}                        // useLeagueData().players
 *     draftOrder={league.draftOrder ?? null} // team ids; null when hidden from non-staff
 *     draftOrderLocked={league.draftOrderLocked}
 *     presence={presence}                    // useDraftState().presence
 *     userTeamId={state.userTeamId}
 *     draftStarted={false}
 *     timerSeconds={timerDuration}           // optional, for the "90s clock" fact
 *     onRehearse={startRehearsal}            // optional; button hidden if omitted
 *     onOrderSaved={refreshLeague}           // refetch league after a save
 *   />
 *
 * Presence: a team is "in the room" when its id appears in
 * `presence.players[].teamId`. Spectators (staff/viewers) are ignored.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Flame } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { Button } from '@/components/ui/button';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { isStaff } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import type { DraftPresenceData } from '../use-draft-websocket';
import { LobbySeats } from './lobby-seats';
import { DraftOrderModal } from './draft-order-modal';
import { snakePicks } from './use-draft-order';

export interface DraftLobbyProps {
  teams: Player[];
  draftOrder: string[] | null;
  /** Undefined (backend not shipped yet) is treated as locked when an order exists. */
  draftOrderLocked?: boolean;
  presence: DraftPresenceData;
  userTeamId: string | null;
  draftStarted: boolean;
  timerSeconds?: number;
  onRehearse?: () => void;
  onOrderSaved?: () => void | Promise<void>;
}

function Countdown({ target }: { target: string | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = target ? new Date(target).getTime() : NaN;
  if (Number.isNaN(t)) return <>Draft night — time TBA</>;
  const s = Math.floor((t - now) / 1000);
  if (s <= 0) return <>Starting soon</>;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (
    <>
      Draft night starts in{' '}
      {d > 0 ? (
        <span className="font-mono font-bold">{d}d {h}h</span>
      ) : (
        <>
          <span className="font-mono font-bold">{h}h {m}m</span>{' '}
          <span className="font-mono font-bold text-neon">{String(sec).padStart(2, '0')}s</span>
        </>
      )}
    </>
  );
}

export function DraftLobby({
  teams, draftOrder, draftOrderLocked, presence, userTeamId, draftStarted,
  timerSeconds, onRehearse, onOrderSaved,
}: DraftLobbyProps) {
  const league = useLeague();
  const { user } = useAuth();
  const staff = isStaff(user);
  const [editing, setEditing] = useState(false);

  const locked = draftOrderLocked ?? draftOrder != null;
  const orderKnown = draftOrder != null && draftOrder.length > 0;

  const presentIds = useMemo(() => new Set(presence.players.map(p => p.teamId)), [presence]);

  const seated = useMemo(() => {
    if (!orderKnown) return [...teams].sort((a, b) => a.teamAbbrev.localeCompare(b.teamAbbrev));
    const by = new Map(teams.map(t => [t.id, t]));
    const ordered = draftOrder!.map(id => by.get(id)).filter((t): t is Player => !!t);
    // Teams missing from a stale order still show, at the end.
    const seen = new Set(ordered.map(t => t.id));
    return [...ordered, ...teams.filter(t => !seen.has(t.id))];
  }, [teams, draftOrder, orderKnown]);

  const rounds = league.season?.rosterSize ?? 10;
  const mySeat = orderKnown && userTeamId ? seated.findIndex(t => t.id === userTeamId) + 1 : 0;
  const myPicks = mySeat > 0 ? snakePicks(mySeat, seated.length, rounds) : [];

  const here = teams.filter(t => presentIds.has(t.id)).length;
  const waiting = teams.filter(t => !presentIds.has(t.id)).map(t => t.teamAbbrev);

  const when = league.draftDate
    ? new Date(league.draftDate).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      }).replace(',', '').toUpperCase()
    : null;
  const facts = [when, `${teams.length} teams`, `${rounds} rounds`, timerSeconds ? `${timerSeconds}s clock` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 flex flex-col items-center gap-6">
      <div className="text-center flex flex-col items-center gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
          <span style={{ color: league.color }}>{league.name}</span> · Season {league.season?.seasonNumber}
        </p>
        <h1 className="font-heading text-2xl sm:text-[28px] font-bold leading-tight">
          <Countdown target={league.draftDate} />
        </h1>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        {teams.map(t => (
          <div
            key={t.id}
            title={t.teamName}
            className={cn('transition-all duration-500', presentIds.has(t.id) ? 'opacity-100' : 'opacity-30 grayscale')}
          >
            <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} logoPath={t.logoPath} className="!size-[34px]" />
          </div>
        ))}
      </div>
      <p className="font-mono text-xs text-text-secondary text-center">
        <span className="text-win">{here}</span> of {teams.length} coaches in the room
        {waiting.length > 0 && <> · waiting on {waiting.join(', ')}</>}
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        {onRehearse && (
          <Button type="button" variant="outline" size="sm" onClick={onRehearse}
            className="border-pink/40 text-pink hover:bg-pink/10">
            <Flame className="size-3.5" /> Warm up — rehearsal
          </Button>
        )}
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/rules" />}>
          <BookOpen className="size-3.5" /> Rules
        </Button>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-wider text-text-muted text-center">{facts}</p>

      <LobbySeats
        leagueId={league.id}
        teams={seated}
        orderKnown={orderKnown}
        presentIds={presentIds}
        userTeamId={userTeamId}
        staff={staff}
        locked={locked}
        draftStarted={draftStarted}
        onEdit={() => setEditing(true)}
        myPicks={myPicks}
      />

      {staff && (
        <DraftOrderModal
          open={editing}
          onOpenChange={setEditing}
          leagueId={league.id}
          leagueName={league.name}
          seasonNumber={league.season?.seasonNumber}
          teams={teams}
          order={seated.map(t => t.id)}
          draftStarted={draftStarted}
          onSaved={() => onOrderSaved?.()}
        />
      )}
    </div>
  );
}
