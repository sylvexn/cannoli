import { useNavigate } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { fixtureShortLabel } from '@/lib/constants';
import type { useAppData } from '@/lib/app-data-context';

export interface LiveMatch {
  id: string; leagueId: string; homePlayer: string; awayPlayer: string;
  week: number; phase: string; playoffRound: string | null;
}

const pill =
  'flex h-7 items-center gap-1.5 rounded-full border border-loss/20 bg-loss/10 px-2.5 text-xs font-semibold text-loss transition-colors hover:bg-loss/15 outline-none focus-visible:ring-2 focus-visible:ring-loss/50';

const Dot = () => (
  <span className="relative flex h-2 w-2">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-loss opacity-75" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-loss" />
  </span>
);

export function LiveIndicator({ matches, leagues }: {
  matches: LiveMatch[]; leagues: ReturnType<typeof useAppData>['leagues'];
}) {
  const navigate = useNavigate();
  if (matches.length === 0) return null;
  if (matches.length === 1) {
    return (
      <button onClick={() => navigate(`/league/${matches[0].leagueId}/schedule`)} className={pill}>
        <Dot /> Live
      </button>
    );
  }
  return (
    <Popover>
      <PopoverTrigger className={pill}><Dot /> Live ({matches.length})</PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-full max-w-72 bg-surface-overlay border-border-default">
        <div className="space-y-1">
          {matches.map(m => {
            const league = leagues.find(l => l.id === m.leagueId);
            return (
              <button
                key={m.id}
                onClick={() => navigate(`/league/${m.leagueId}/schedule`)}
                className="flex w-full items-center gap-2 text-xs transition-colors hover:text-gem-ink"
              >
                <span className="font-bold" style={{ color: league?.color }}>{league?.name.replace(' League', '')}</span>
                <span className="text-text-muted">{fixtureShortLabel(m)}</span>
                <span className="text-text-primary">{m.homePlayer} vs {m.awayPlayer}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
