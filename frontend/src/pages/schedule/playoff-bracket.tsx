import { useMemo } from 'react';
import { useLeagueData } from '@/lib/league-data-context';
import { TeamLogo } from '@/components/team-logo';
import { cn } from '@/lib/utils';
import { Trophy } from 'lucide-react';
import type { Match, Player } from '@/lib/types';

interface BracketMatch {
  match: Match | null;
  home: Player | null;
  away: Player | null;
  winner: string | null;
}

export function PlayoffBracket() {
  const { matches, players } = useLeagueData();

  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const playoffMatches = useMemo(
    () => matches.filter(m => m.phase === 'playoffs'),
    [matches],
  );

  const byRound = useMemo(() => {
    const groups: Record<string, BracketMatch[]> = { qf: [], sf: [], f: [] };
    for (const m of playoffMatches) {
      const round = m.playoffRound || 'qf';
      const home = playerMap.get(m.homePlayer) || null;
      const away = playerMap.get(m.awayPlayer) || null;
      const winner = m.homeScore != null && m.awayScore != null
        ? (m.homeScore > m.awayScore ? m.homePlayer : m.awayPlayer)
        : null;
      groups[round]?.push({ match: m, home, away, winner });
    }
    // Sort by seed
    for (const round of Object.keys(groups)) {
      groups[round].sort((a, b) => (a.match?.homeSeed ?? 99) - (b.match?.homeSeed ?? 99));
    }
    return groups;
  }, [playoffMatches, playerMap]);

  if (playoffMatches.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        Playoff bracket not yet available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bracket grid */}
      <div className="flex gap-6 items-start overflow-x-auto pb-4">
        {/* Quarter Finals */}
        <BracketColumn
          label="Quarter Finals"
          matches={byRound.qf}

          spacing="normal"
        />

        {/* Connectors */}
        <div className="flex flex-col justify-around self-stretch py-8">
          {[0, 1].map(i => (
            <div key={i} className="flex flex-col items-center" style={{ height: '50%' }}>
              <div className="w-6 border-t border-r border-border-subtle h-1/2" />
              <div className="w-6 border-b border-r border-border-subtle h-1/2" />
            </div>
          ))}
        </div>

        {/* Semi Finals */}
        <BracketColumn
          label="Semi Finals"
          matches={byRound.sf}

          spacing="wide"
        />

        {/* Connectors */}
        <div className="flex flex-col justify-center self-stretch">
          <div className="w-6 border-t border-r border-border-subtle h-1/4" />
          <div className="w-6 border-b border-r border-border-subtle h-1/4" />
        </div>

        {/* Finals */}
        <BracketColumn
          label="Finals"
          matches={byRound.f}

          spacing="center"
        />

        {/* Champion */}
        {byRound.f.length > 0 && byRound.f[0].winner && (
          <div className="flex flex-col items-center justify-center self-stretch gap-2 px-4">
            <Trophy size={20} className="text-draw" />
            <span className="text-xs font-heading font-bold text-draw uppercase tracking-wider">Champion</span>
            {(() => {
              const champ = playerMap.get(byRound.f[0].winner);
              if (!champ) return null;
              return (
                <div className="flex items-center gap-2">
                  <TeamLogo abbrev={champ.teamAbbrev} color={champ.teamColor} size="md" />
                  <span className="text-sm font-bold text-text-primary">{champ.teamName}</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function BracketColumn({ label, matches, spacing }: {
  label: string;
  matches: BracketMatch[];
  spacing: 'normal' | 'wide' | 'center';
}) {
  return (
    <div className={cn(
      'flex flex-col gap-4 min-w-[240px]',
      spacing === 'wide' && 'justify-around',
      spacing === 'center' && 'justify-center',
    )}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted text-center">
        {label}
      </div>
      {matches.length === 0 && (
        <div className="text-center py-8 text-text-muted text-xs border border-dashed border-border-subtle rounded-lg">
          TBD
        </div>
      )}
      {matches.map((bm, i) => (
        <BracketMatchCard key={bm.match?.id ?? i} bm={bm} />
      ))}
    </div>
  );
}

function BracketMatchCard({ bm }: { bm: BracketMatch }) {
  const { match, home, away, winner } = bm;
  if (!match) return null;

  const homeWon = winner === match.homePlayer;
  const awayWon = winner === match.awayPlayer;
  const hasResult = match.homeScore != null;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised overflow-hidden">
      {/* Home team */}
      <BracketTeamRow
        player={home}
        seed={match.homeSeed}
        score={match.homeScore}
        isWinner={homeWon}
        isLoser={awayWon}
        hasResult={hasResult}
      />
      <div className="h-px bg-border-subtle" />
      {/* Away team */}
      <BracketTeamRow
        player={away}
        seed={match.awaySeed}
        score={match.awayScore}
        isWinner={awayWon}
        isLoser={homeWon}
        hasResult={hasResult}
      />
    </div>
  );
}

function BracketTeamRow({ player, seed, score, isWinner, isLoser, hasResult }: {
  player: Player | null;
  seed: number | null | undefined;
  score: number | undefined;
  isWinner: boolean;
  isLoser: boolean;
  hasResult: boolean;
}) {
  if (!player) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 text-text-muted text-xs">
        TBD
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 transition-colors',
      isWinner && 'bg-win/5',
      isLoser && 'opacity-50',
    )}>
      {/* Seed */}
      <span className={cn(
        'text-[10px] font-bold font-mono w-4 text-center shrink-0',
        isWinner ? 'text-win' : 'text-text-muted',
      )}>
        {seed}
      </span>

      {/* Team */}
      <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
      <span className={cn(
        'text-xs font-medium flex-1 min-w-0 truncate',
        isWinner ? 'text-win' : isLoser ? 'text-text-muted' : 'text-text-primary',
      )}>
        {player.teamAbbrev}
      </span>

      {/* Score */}
      {hasResult && (
        <span className={cn(
          'text-sm font-bold font-mono tabular-nums shrink-0',
          isWinner ? 'text-win' : 'text-text-muted',
        )}>
          {score}
        </span>
      )}

      {/* Winner indicator */}
      {isWinner && (
        <div className="w-1 h-4 rounded-full bg-win shrink-0" />
      )}
    </div>
  );
}
