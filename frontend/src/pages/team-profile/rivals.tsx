/**
 * Top-2 rivals callout for the team detail page.
 *
 * Computed from completed matches. The "rivalry" signal we surface is the
 * stronger of:
 *   - **most matches played** vs that opponent (volume signal — repeat
 *     match-ups across seasons accumulate)
 *   - **closest record** when matches >= 2 (margin = |wins-losses|; smaller
 *     is closer)
 *
 * We score each opponent on both axes, normalize, and pick the top 2 by the
 * higher of the two scores. With ≤ 2 opponents on the schedule the "rivals"
 * concept doesn't apply — return early.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import type { Player } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeagueUrl } from '@/lib/use-league-url';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';

interface RivalsProps {
  player: Player;
}

interface RivalRow {
  opponent: Player;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  closeness: number; // 0..1 — higher = closer record
  signal: 'closest' | 'most-played';
}

const MIN_MATCHES = 2; // Below this, "rivalry" doesn't read as anything.

export function Rivals({ player }: RivalsProps) {
  const { matches, players } = useLeagueData();
  const leagueUrl = useLeagueUrl();
  const playerById = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const rivals = useMemo<RivalRow[]>(() => {
    // Aggregate H2H stats per opponent.
    const byOpp = new Map<string, { wins: number; losses: number; draws: number }>();
    for (const m of matches) {
      if (m.homePlayer !== player.id && m.awayPlayer !== player.id) continue;
      if (m.homeScore == null || m.awayScore == null) continue;
      const isHome = m.homePlayer === player.id;
      const oppId = isHome ? m.awayPlayer : m.homePlayer;
      const myScore = isHome ? m.homeScore : m.awayScore;
      const oppScore = isHome ? m.awayScore : m.homeScore;
      const row = byOpp.get(oppId) ?? { wins: 0, losses: 0, draws: 0 };
      if (myScore > oppScore) row.wins++;
      else if (oppScore > myScore) row.losses++;
      else row.draws++;
      byOpp.set(oppId, row);
    }

    if (byOpp.size === 0) return [];

    const rows: RivalRow[] = [];
    let maxPlayed = 0;
    for (const [, r] of byOpp) {
      const played = r.wins + r.losses + r.draws;
      if (played > maxPlayed) maxPlayed = played;
    }

    for (const [oppId, r] of byOpp) {
      const opp = playerById.get(oppId);
      if (!opp) continue;
      const played = r.wins + r.losses + r.draws;
      if (played < MIN_MATCHES) continue;
      // Closeness: 1 - |wins-losses|/played. A 3-3 split = 1.0 (max),
      // a sweep = 0.0. Scale by `played` so a 1-1 (close but tiny sample)
      // ranks below a 4-4 (close AND lots of matches).
      const margin = Math.abs(r.wins - r.losses) / played;
      const closeness = (1 - margin) * Math.min(1, played / Math.max(1, maxPlayed));
      rows.push({
        opponent: opp,
        played,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        closeness,
        signal: closeness > (played / Math.max(1, maxPlayed)) ? 'closest' : 'most-played',
      });
    }

    // Score = max(closeness, played-share). Pick top 2.
    rows.sort((a, b) => {
      const aShare = a.played / Math.max(1, maxPlayed);
      const bShare = b.played / Math.max(1, maxPlayed);
      return Math.max(b.closeness, bShare) - Math.max(a.closeness, aShare);
    });
    return rows.slice(0, 2);
  }, [matches, player.id, playerById]);

  if (rivals.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-muted flex items-center gap-1.5">
          <Flame size={11} className="text-orange-400" />
          Rivals
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rivals.map(r => (
          <Link
            key={r.opponent.id}
            to={leagueUrl(`/teams/${r.opponent.id}`)}
            className="flex items-center gap-2.5 rounded-md border border-border-default bg-surface-overlay/40 px-2.5 py-2 hover:bg-surface-overlay hover:border-neon/30 transition-colors group"
            style={{ ['--card-accent' as never]: r.opponent.teamColor }}
          >
            <TeamLogo abbrev={r.opponent.teamAbbrev} color={r.opponent.teamColor} size="md" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary group-hover:text-neon transition-colors truncate">
                {r.opponent.teamName}
              </div>
              <div className="text-[10px] font-mono text-text-muted flex items-center gap-1.5">
                <RecordDisplay wins={r.wins} losses={r.losses} className="text-[10px]" />
                <span className="text-text-muted/60">·</span>
                <span>{r.signal === 'closest' ? 'closest record' : 'most matches'}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
