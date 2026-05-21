/**
 * Compact horizontal strip of auto-derived headlines (longest streak,
 * recent upset, biggest trade) shown above the activity feed on the
 * community home. Each card links into the relevant league page.
 */

import { Link } from 'react-router-dom';
import { Flame, ArrowLeftRight, Zap } from 'lucide-react';
import type { Headline } from './headlines';

interface HeadlinesStripProps {
  headlines: Headline[];
}

export function HeadlinesStrip({ headlines }: HeadlinesStripProps) {
  if (headlines.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised px-3 py-2 overflow-x-auto">
      <div className="flex items-stretch gap-2 min-w-min">
        {headlines.map((h, i) => (
          <HeadlineCard key={i} headline={h} />
        ))}
      </div>
    </div>
  );
}

function HeadlineCard({ headline }: { headline: Headline }) {
  if (headline.kind === 'streak') {
    return (
      <Link
        to={`/league/${headline.leagueId}/teams/${headline.teamId}`}
        viewTransition
        className="shrink-0 group flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 hover:bg-surface-overlay hover:border-orange-400/40 transition-colors"
        style={{ ['--card-accent' as never]: headline.teamColor }}
      >
        <Flame size={14} className="shrink-0 text-orange-400" />
        <div className="leading-tight">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            On a roll
          </div>
          <div className="text-[12px] font-heading text-text-primary group-hover:text-neon transition-colors">
            <span style={{ color: headline.teamColor }}>{headline.teamAbbrev}</span>{' '}
            <span className="font-mono tabular-nums text-text-muted">
              {headline.streak} W
            </span>
          </div>
        </div>
      </Link>
    );
  }

  if (headline.kind === 'upset') {
    return (
      <Link
        to={`/league/${headline.leagueId}`}
        viewTransition
        className="shrink-0 group flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 hover:bg-surface-overlay hover:border-amber-400/40 transition-colors"
      >
        <Zap size={14} className="shrink-0 text-amber-400" />
        <div className="leading-tight">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Upset
          </div>
          <div className="text-[12px] font-heading text-text-primary group-hover:text-neon transition-colors">
            <span style={{ color: headline.winnerColor }}>{headline.winnerName}</span>
            <span className="text-text-muted"> beat </span>
            <span>{headline.loserName}</span>
          </div>
        </div>
      </Link>
    );
  }

  // trade
  return (
    <Link
      to={`/league/${headline.leagueId}/trades`}
      viewTransition
      className="shrink-0 group flex items-center gap-2 px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 hover:bg-surface-overlay hover:border-pink/40 transition-colors"
    >
      <ArrowLeftRight size={14} className="shrink-0 text-pink" />
      <div className="leading-tight">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          Big trade
        </div>
        <div className="text-[12px] font-heading text-text-primary group-hover:text-neon transition-colors">
          {headline.teamA} ↔ {headline.teamB}
          <span className="text-text-muted font-mono tabular-nums ml-1">
            ({headline.pokemonCount} mons)
          </span>
        </div>
      </div>
    </Link>
  );
}
