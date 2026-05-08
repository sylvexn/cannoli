import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { cn } from '@/lib/utils';

/**
 * League deep-dive page at /archive/:seasonId/:leagueId. Step 5 ships the
 * minimal viable surface — pulls /api/archive/leagues/:id/full and renders
 * the standings table. Step 8 will tab this out into Standings / Schedule
 * / Draft / Transactions / Leaderboards / Bracket / Awards.
 */

interface FullLeague {
  league: {
    id: string;
    name: string;
    color: string;
    seasonNumber: number | null;
    archived: boolean;
  };
  teams: {
    id: string;
    coachName: string;
    teamName: string;
    teamAbbrev: string;
    teamColor: string;
    rank: number;
    record: { wins: number; losses: number; differential: number };
    roster: { name: string; tier: number; isTeraCaptain: boolean }[];
  }[];
  schedule: { id: string; week: number; phase: string }[];
  draft: { pickNumber: number }[];
  transactions: { id: number }[];
}

export function ArchiveLeaguePage() {
  const { seasonId, leagueId } = useParams<{ seasonId: string; leagueId: string }>();
  const [data, setData] = useState<FullLeague | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) return;
    setLoading(true);
    fetch(`/api/archive/leagues/${leagueId}/full`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [leagueId]);

  if (loading) return <div className="text-text-muted py-20 text-center text-sm">Loading league…</div>;
  if (!data || !('league' in data)) return <div className="text-text-muted py-20 text-center">League not found.</div>;

  const { league, teams, schedule, draft, transactions } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span style={{ color: league.color }}>{league.name.split(' ')[0]}</span>{' '}
            <span className="text-text-primary">{league.name.split(' ').slice(1).join(' ') || 'League'}</span>
          </h1>
          <p className="text-sm text-text-muted">
            Season {league.seasonNumber} · {teams.length} teams · {schedule.length} matches · {draft.length} draft picks · {transactions.length} transactions
          </p>
        </div>
      </div>

      <Card className="bg-surface-raised border-border-default">
        <div className="h-1.5" style={{ backgroundColor: league.color }} />
        <CardContent className="p-4 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
            Final Standings
          </div>
          {teams.map((team, i) => (
            <Link
              key={team.id}
              to={`/archive/${seasonId}/${leagueId}/${team.id}`}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-overlay/50 transition-colors',
                i < 3 && 'bg-surface-overlay/30',
              )}
            >
              <span className={cn(
                'text-xs font-bold font-mono w-6 text-center shrink-0',
                i === 0 ? 'text-draw' : i < 3 ? 'text-neon' : 'text-text-muted',
              )}>
                {i + 1}
              </span>
              <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-text-primary truncate block">{team.teamName}</span>
                <span className="text-[11px] text-text-muted">{team.coachName}</span>
              </div>
              <RecordDisplay
                wins={team.record.wins}
                losses={team.record.losses}
                differential={team.record.differential}
                className="text-xs"
              />
            </Link>
          ))}
        </CardContent>
      </Card>

      <Badge variant="outline" className="text-[10px] text-text-muted border-border-default">
        Step 8 will add tabs for Schedule / Draft / Transactions / Leaderboards / Bracket / Awards
      </Badge>
    </div>
  );
}
