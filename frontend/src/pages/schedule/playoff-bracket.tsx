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

type RoundKey = 'qf' | 'sf' | 'f';

const ROUND_LABEL: Record<RoundKey, string> = {
  qf: 'Quarter Finals',
  sf: 'Semi Finals',
  f: 'Finals',
};

export function PlayoffBracket() {
  const { matches, players } = useLeagueData();

  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const playoffMatches = useMemo(
    () => matches.filter(m => m.phase === 'playoffs'),
    [matches],
  );

  const byRound = useMemo(() => {
    const groups: Record<RoundKey, BracketMatch[]> = { qf: [], sf: [], f: [] };
    for (const m of playoffMatches) {
      const round = (m.playoffRound || 'qf') as RoundKey;
      const home = playerMap.get(m.homePlayer) || null;
      const away = playerMap.get(m.awayPlayer) || null;
      const winner = m.homeScore != null && m.awayScore != null
        ? (m.homeScore > m.awayScore ? m.homePlayer : m.awayPlayer)
        : null;
      groups[round]?.push({ match: m, home, away, winner });
    }
    // Sort by match id (preserves generation order: qf1, qf2, …, sf1, sf2, …)
    for (const round of Object.keys(groups) as RoundKey[]) {
      groups[round].sort((a, b) => (a.match?.id ?? '').localeCompare(b.match?.id ?? ''));
    }
    return groups;
  }, [playoffMatches, playerMap]);

  // Only show rounds that actually exist. Bracket size:
  //   2 → F
  //   4 → SF + F
  //   6 → QF (top 2 bye) + SF + F
  //   8 → QF (full) + SF + F
  const presentRounds: RoundKey[] = (['qf', 'sf', 'f'] as RoundKey[]).filter(
    r => byRound[r].length > 0,
  );

  if (playoffMatches.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        Playoff bracket not yet available
      </div>
    );
  }

  const finalsWinnerId = byRound.f[0]?.winner ?? null;

  return (
    <div className="space-y-6">
      <div className="flex gap-6 items-start overflow-x-auto pb-4">
        {presentRounds.map((round, i) => {
          const isLast = i === presentRounds.length - 1;
          const spacing: 'normal' | 'wide' | 'center' =
            round === 'qf' ? 'normal' : round === 'sf' ? 'wide' : 'center';
          return (
            <RoundColumnWithConnector
              key={round}
              label={ROUND_LABEL[round]}
              matches={byRound[round]}
              spacing={spacing}
              showConnector={!isLast}
              connectorRound={round}
            />
          );
        })}

        {/* Champion */}
        {finalsWinnerId && (
          <div className="flex flex-col items-center justify-center self-stretch gap-2 px-4">
            <Trophy size={20} className="text-draw" />
            <span className="text-xs font-heading font-bold text-draw uppercase tracking-wider">Champion</span>
            {(() => {
              const champ = playerMap.get(finalsWinnerId);
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

function RoundColumnWithConnector({ label, matches, spacing, showConnector, connectorRound }: {
  label: string;
  matches: BracketMatch[];
  spacing: 'normal' | 'wide' | 'center';
  showConnector: boolean;
  connectorRound: RoundKey;
}) {
  return (
    <>
      <BracketColumn label={label} matches={matches} spacing={spacing} />
      {showConnector && (
        <div className="flex flex-col justify-around self-stretch py-8">
          {Array.from({ length: Math.max(1, Math.ceil(matches.length / 2)) }).map((_, i) => (
            <div
              key={`${connectorRound}-${i}`}
              className="flex flex-col items-center"
              style={{ height: matches.length > 1 ? `${100 / Math.ceil(matches.length / 2)}%` : '50%' }}
            >
              <div className="w-6 border-t border-r border-border-subtle h-1/2" />
              <div className="w-6 border-b border-r border-border-subtle h-1/2" />
            </div>
          ))}
        </div>
      )}
    </>
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
      <BracketTeamRow
        player={home}
        seed={match.homeSeed}
        score={match.homeScore}
        isWinner={homeWon}
        isLoser={awayWon}
        hasResult={hasResult}
      />
      <div className="h-px bg-border-subtle" />
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
      <span className={cn(
        'text-[10px] font-bold font-mono w-4 text-center shrink-0',
        isWinner ? 'text-win' : 'text-text-muted',
      )}>
        {seed}
      </span>

      <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
      <span className={cn(
        'text-xs font-medium flex-1 min-w-0 truncate',
        isWinner ? 'text-win' : isLoser ? 'text-text-muted' : 'text-text-primary',
      )}>
        {player.teamAbbrev}
      </span>

      {hasResult && (
        <span className={cn(
          'text-sm font-bold font-mono tabular-nums shrink-0',
          isWinner ? 'text-win' : 'text-text-muted',
        )}>
          {score}
        </span>
      )}

      {isWinner && (
        <div className="w-1 h-4 rounded-full bg-win shrink-0" />
      )}
    </div>
  );
}
