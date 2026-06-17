/**
 * YourMatchesCard — compact, read-only surface for the coach's playable
 * league fixtures on the dashboard home page. Mirrors the Arena footer's
 * "Your Matches" panel so coaches see their fixtures WITHOUT having to open
 * the Showdown tab and expand the (collapsed-by-default) footer.
 *
 * Fetches /api/arena/state directly (the same seed the Arena WS uses) and
 * lists the coach's playable matches (current week + the next couple). Each
 * row links to the opponent's team page; the whole card routes into the Arena
 * via /showdown?tab=arena (which force-opens the Match panel there).
 *
 * Renders nothing unless the user is logged in AND has at least one playable
 * match — no empty box on the dashboard.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Swords, ChevronRight, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ArenaMatch } from '@/pages/showdown/use-arena-websocket';

export function YourMatchesCard() {
  const [matches, setMatches] = useState<ArenaMatch[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/arena/state', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        setMatches(Array.isArray(data?.myMatches) ? data.myMatches : []);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });
    return () => { cancelled = true; };
  }, []);

  const playable = (matches ?? []).filter(
    m => m.status !== 'completed' && m.status !== 'disputed',
  );

  // No empty box — only render when there's something to play.
  if (!matches || playable.length === 0) return null;

  // Current-week fixtures first, then ascending by week.
  const ordered = [...playable].sort((a, b) => {
    if (!!a.isCurrentWeek !== !!b.isCurrentWeek) return a.isCurrentWeek ? -1 : 1;
    return a.week - b.week;
  });

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Swords size={14} className="text-orange-400" />
          Your Matches
          <Badge className="ml-auto bg-orange-400/15 text-orange-400 border-orange-400/30 text-[10px]">
            {playable.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {ordered.slice(0, 5).map(m => (
          <MatchRow key={m.matchId} match={m} />
        ))}
        <Link
          to="/showdown?tab=arena"
          className="flex items-center gap-1 px-2 pt-1 text-[11px] text-text-muted hover:text-neon transition-colors"
        >
          Go to Arena
          <ChevronRight size={12} />
        </Link>
      </CardContent>
    </Card>
  );
}

function MatchRow({ match }: { match: ArenaMatch }) {
  const navigate = useNavigate();
  const opponent = match.isHome ? match.awayTeam : match.homeTeam;
  const live = match.status === 'in_progress';
  const dot =
    live ? 'bg-green-400 animate-pulse'
    : match.status === 'ready' ? 'bg-orange-400'
    : 'bg-text-muted';

  // The row itself is a button (not an <a>) so the opponent name can stay a
  // real <Link> without nesting anchors. Keyboard: Enter/Space activate it.
  const goToArena = () => navigate('/showdown?tab=arena');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToArena}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToArena();
        }
      }}
      className="block px-2 py-1.5 rounded-md hover:bg-surface-overlay/60 transition-colors group cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-neon/50"
    >
      <div className="flex items-center gap-2 text-xs">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="font-mono text-text-secondary shrink-0">W{match.week}</span>
        {match.isCurrentWeek && (
          <span className="text-[9px] font-mono uppercase text-orange-400/80 shrink-0">now</span>
        )}
        <span className="text-text-muted shrink-0">vs</span>
        {opponent ? (
          <OpponentLink leagueId={match.leagueId} team={opponent} />
        ) : (
          <span className="text-text-muted truncate">TBD</span>
        )}
        {live && (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-green-400 font-medium shrink-0">
            <Zap size={10} /> LIVE
          </span>
        )}
        <ChevronRight
          size={12}
          className={`${live ? '' : 'ml-auto'} text-text-muted/40 group-hover:text-neon transition-colors shrink-0`}
        />
      </div>
    </div>
  );
}

function OpponentLink({
  leagueId, team,
}: {
  leagueId: string;
  team: NonNullable<ArenaMatch['homeTeam']>;
}) {
  return (
    <Link
      to={`/league/${leagueId}/teams/${team.id}`}
      onClick={e => e.stopPropagation()}
      className="font-medium text-text-primary hover:text-neon hover:underline transition-colors truncate"
    >
      {team.name}
    </Link>
  );
}
