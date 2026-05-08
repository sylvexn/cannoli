import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Archive as ArchiveIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Top-level archive hub at /archive — shows every season ever recorded as a
 * clickable card. Step 6 fleshes this out with the all-time trophy case +
 * leader board strips; step 5 ships the navigable skeleton so the rest of
 * the routing tree can be exercised end-to-end.
 */

interface AllTimePayload {
  seasons: {
    id: number;
    seasonNumber: number;
    pointCap: number;
    teraCaptainSlots: number;
    archived: boolean;
    leagueCount: number;
  }[];
  champions: { seasonNumber: number; leagueId: string; leagueName: string; leagueColor: string; coachName: string; teamName: string }[];
}

export function ArchiveHubPage() {
  const [data, setData] = useState<AllTimePayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/archive/all-time')
      .then(r => r.json())
      .then((d: AllTimePayload) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-purple-400">Record</span>{' '}
          <span className="text-text-primary">Book</span>
        </h1>
        <p className="text-sm text-text-muted">Every season, every champion, every record</p>
      </div>

      {loading ? (
        <div className="text-text-muted py-20 text-center text-sm">Loading archive…</div>
      ) : !data || data.seasons.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-surface-raised/40 py-16 px-6 flex flex-col items-center justify-center text-center">
          <div className="rounded-full p-4 bg-purple-400/5 border border-purple-400/20 mb-4">
            <ArchiveIcon size={28} className="text-purple-400/70" />
          </div>
          <h2 className="text-base font-medium text-text-primary mb-1">No seasons yet</h2>
          <p className="text-sm text-text-muted max-w-sm">
            Once a season is archived, it'll appear here with full league deep-dives.
          </p>
        </div>
      ) : (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-2">
            Seasons ({data.seasons.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.seasons.map(season => {
              const seasonChampions = data.champions.filter(c => c.seasonNumber === season.seasonNumber);
              return (
                <Link
                  key={season.id}
                  to={`/archive/${season.id}`}
                  className={cn(
                    'group rounded-xl border bg-surface-raised hover:bg-surface-overlay/50 transition-colors',
                    season.archived ? 'border-border-default' : 'border-border-default/60',
                  )}
                >
                  <Card className="border-0 bg-transparent shadow-none">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-lg font-bold text-purple-400">
                            S{season.seasonNumber}
                          </span>
                          {season.archived && (
                            <Badge variant="outline" className="text-[9px] text-text-muted border-border-default uppercase tracking-wider">
                              Archived
                            </Badge>
                          )}
                        </div>
                        <ArrowRight size={14} className="text-text-muted group-hover:text-text-primary transition-colors" />
                      </div>

                      <div className="text-[11px] text-text-muted flex items-center gap-2">
                        <span>{season.leagueCount} leagues</span>
                        <span>·</span>
                        <span>{season.pointCap}pt cap</span>
                        <span>·</span>
                        <span>{season.teraCaptainSlots} captains</span>
                      </div>

                      {seasonChampions.length > 0 && (
                        <div className="border-t border-border-subtle pt-2 space-y-1">
                          <div className="text-[9px] uppercase tracking-wider text-text-muted">Champions</div>
                          {seasonChampions.map(c => (
                            <div key={c.leagueId} className="flex items-center gap-1.5 text-[11px]">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: c.leagueColor }}
                              />
                              <span className="font-medium text-text-primary truncate">{c.coachName}</span>
                              <span className="text-text-muted truncate">· {c.teamName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
