import { TeamLogo } from '@/components/team-logo';
import { TeamLink } from '@/components/team-link';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import { StaffTag } from './staff-tag';

interface LobbySeatsProps {
  leagueId: string;
  /** Teams already arranged in seat order (or neutral order when `orderKnown` is false). */
  teams: Player[];
  orderKnown: boolean;
  presentIds: Set<string>;
  userTeamId: string | null;
  staff: boolean;
  locked: boolean;
  draftStarted: boolean;
  onEdit: () => void;
  myPicks: number[];
}

export function LobbySeats({
  leagueId, teams, orderKnown, presentIds, userTeamId, staff, locked, draftStarted, onEdit, myPicks,
}: LobbySeatsProps) {
  return (
    <section className="w-full">
      <div className="flex items-center gap-3 border-b border-border-subtle pb-2 mb-3 min-h-8">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary">
          Draft order · snake
        </h2>
        <div className="ml-auto flex items-center gap-3 min-w-0">
          {staff && (
            <>
              <span className="hidden sm:inline font-mono text-[10px] text-text-muted truncate">
                {locked ? 'locked' : 'not locked — coaches see "order TBD"'}
              </span>
              <button
                type="button"
                onClick={onEdit}
                disabled={draftStarted}
                className="inline-flex items-center gap-2 shrink-0 rounded-md border border-pink/40 px-2.5 h-7 font-mono text-[11px] uppercase tracking-wider text-pink hover:bg-pink/10 disabled:opacity-40 disabled:pointer-events-none"
              >
                Edit order <StaffTag />
              </button>
            </>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-2 min-[440px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {teams.map((t, i) => {
          const here = presentIds.has(t.id);
          const mine = t.id === userTeamId;
          return (
            <li
              key={t.id}
              className={cn(
                'relative min-w-0 rounded-lg border bg-surface-raised px-3 py-2.5 flex flex-col items-center gap-1 text-center transition-opacity',
                mine ? 'border-neon ring-1 ring-neon/60' : 'border-border-subtle',
                !here && 'opacity-50',
              )}
            >
              <span className="absolute top-1.5 left-2 font-mono text-[11px] text-text-muted">
                {orderKnown ? i + 1 : '?'}
              </span>
              <span
                aria-label={here ? 'in the room' : 'not here'}
                className={cn(
                  'absolute top-2 right-2 size-1.5 rounded-full',
                  here ? 'bg-win' : 'bg-text-muted/40',
                )}
              />
              <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} logoPath={t.logoPath} size="md" />
              <TeamLink
                noHoverCard
                showLogo={false}
                team={{ leagueId, teamId: t.id, teamName: t.teamName, teamAbbrev: t.teamAbbrev, teamColor: t.teamColor }}
                className="max-w-full truncate font-mono text-xs font-bold"
              >
                {t.teamAbbrev}
              </TeamLink>
              <span className="max-w-full truncate text-[11px] text-text-secondary">
                {t.owner?.displayName ?? t.owner?.username ?? t.name}
              </span>
            </li>
          );
        })}
      </ul>

      {!orderKnown && !staff && (
        <p className="mt-3 text-center text-xs text-text-muted">
          Order TBD — staff will publish it before draft night.
        </p>
      )}
      {orderKnown && myPicks.length > 0 && (
        <p className="mt-3 text-center font-mono text-xs text-text-secondary">
          Your picks: <span className="text-neon">{myPicks.join(' · ')}</span>
        </p>
      )}
    </section>
  );
}
