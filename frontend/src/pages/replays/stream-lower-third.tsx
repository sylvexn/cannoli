import type { League } from '@/lib/types';
import type { ApiTeam } from '@/lib/api';

interface LowerThirdProps {
  league: League;
  week: number;
  matchIndex: number;
  total: number;
  homeTeam: ApiTeam | undefined;
  awayTeam: ApiTeam | undefined;
}

/**
 * Small lower-third broadcast pill — fixed bottom-left while playback runs.
 * Always visible while shown (independent of cursor-idle fade).
 */
export function StreamLowerThird({ league, week, matchIndex, total, homeTeam, awayTeam }: LowerThirdProps) {
  return (
    <div className="fixed bottom-6 left-6 z-30 pointer-events-none">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 shadow-xl">
        <div className={`league-banner league-banner-${league.id}`} style={{ minWidth: 0 }}>
          <span className="league-banner-text text-white">
            {league.name.replace(' League', '')}
          </span>
        </div>

        <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
          W{week} · M{matchIndex + 1}/{total}
        </span>

        <span className="text-[11px] font-semibold text-white">
          {homeTeam?.teamAbbrev ?? '???'}
          <span className="text-text-muted mx-1">vs</span>
          {awayTeam?.teamAbbrev ?? '???'}
        </span>
      </div>
    </div>
  );
}
