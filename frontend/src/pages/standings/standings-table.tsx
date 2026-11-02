import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TeamLogo } from '@/components/team-logo';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { teamTintStyle } from '@/lib/color';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';

const COLS = 'grid-cols-[28px_minmax(0,1fr)_56px_48px] sm:grid-cols-[28px_minmax(0,1fr)_56px_48px_64px]';

/** Last-5 results (oldest to newest) from completed matches with recorded scores. */
function useForm(teamId: string) {
  const { getTeamMatches } = useLeagueData();
  return useMemo(() => {
    const out: boolean[] = [];
    for (const m of getTeamMatches(teamId)) {
      if (m.phase === 'playoffs' || m.homeScore == null || m.awayScore == null || m.homeScore === m.awayScore) continue;
      const home = m.homePlayer === teamId;
      out.push(home ? m.homeScore > m.awayScore : m.awayScore > m.homeScore);
    }
    return out.slice(-5);
  }, [getTeamMatches, teamId]);
}

function FormDots({ teamId }: { teamId: string }) {
  const form = useForm(teamId);
  return (
    <span className="hidden sm:flex items-center justify-end gap-1" aria-label={form.map(w => (w ? 'W' : 'L')).join(' ')}>
      {form.map((w, i) => (
        <span
          key={i}
          className={cn('size-2 rounded-full', w ? 'bg-win' : 'border-[1.5px] border-loss')}
        />
      ))}
    </span>
  );
}

function Row({ player, rank, isMe, onSelect }: { player: Player; rank: number; isMe: boolean; onSelect: (p: Player) => void }) {
  const leagueUrl = useLeagueUrl();
  const diff = player.record.differential;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(player)}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect(player);
        }
      }}
      style={isMe ? { background: 'var(--gem-soft)' } : teamTintStyle(player.teamColor)}
      className={cn(
        'group relative grid items-center gap-2 h-[34px] pl-2 pr-3 cursor-pointer border-b border-border-subtle',
        'hover:bg-surface-overlay/40 focus-visible:outline-none focus-visible:bg-surface-overlay/40',
        COLS,
      )}
    >
      <span
        aria-hidden
        className="absolute left-0 inset-y-0 w-0.5 bg-gem origin-center scale-y-0 transition-transform duration-150 group-hover:scale-y-100 group-focus-visible:scale-y-100"
      />
      <span className="font-mono text-xs text-text-muted text-center tabular-nums">{rank}</span>
      <span className="flex items-center gap-2 min-w-0">
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} logoPath={player.logoPath} className="!w-6 !h-6 shrink-0" />
        <Link
          to={leagueUrl(`/teams/${player.id}`)}
          onClick={e => e.stopPropagation()}
          className={cn('truncate text-sm hover:underline', isMe ? 'font-bold text-text-primary' : 'text-text-primary')}
        >
          {player.teamName}
        </Link>
      </span>
      <span className="font-mono text-xs text-text-primary text-right tabular-nums">
        {player.record.wins}–{player.record.losses}
      </span>
      <span className={cn('font-mono text-xs text-right tabular-nums', diff > 0 ? 'text-text-primary' : 'text-text-muted')}>
        {diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : '0'}
      </span>
      <FormDots teamId={player.id} />
    </div>
  );
}

export function StandingsTable({ standings, myTeamId, playoffCount, ranked, onSelect }: {
  standings: Player[];
  myTeamId: string | null;
  playoffCount: number;
  /** False pre-season: ordering is meaningless so no playoff line. */
  ranked: boolean;
  onSelect: (p: Player) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[320px]">
        <div className={cn('grid items-center gap-2 h-6 pl-2 pr-3 text-[11px] text-text-muted border-b border-border-default', COLS)}>
          <span className="text-center">#</span>
          <span>Team</span>
          <span className="text-right">Record</span>
          <span className="text-right">KO diff</span>
          <span className="hidden sm:block text-right">Form</span>
        </div>
        {standings.map((p, i) => (
          <Fragment key={p.id}>
            <Row player={p} rank={i + 1} isMe={p.id === myTeamId} onSelect={onSelect} />
            {ranked && i + 1 === playoffCount && i + 1 < standings.length && (
              <div className="relative h-0 border-t border-dashed border-gem" aria-hidden>
                <span className="absolute right-3 -top-2 bg-surface px-1.5 text-[10px] text-gem-ink leading-4">Playoff line</span>
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
