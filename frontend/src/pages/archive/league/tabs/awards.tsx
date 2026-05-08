import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FullLeagueData, SeasonAward } from '../types';

/** Awards tab — pins minted for this league this season. Pulls from
 *  /api/archive/seasons/:id/awards (whole-season scope) and filters down
 *  to pins whose metadata.teamId points at a team in this league. */
export function AwardsTab({ data }: { data: FullLeagueData }) {
  const [awards, setAwards] = useState<SeasonAward[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!data.league.seasonId) { setLoading(false); return; }
    fetch(`/api/archive/seasons/${data.league.seasonId}/awards`)
      .then(r => r.json())
      .then((d: { pins: SeasonAward[] }) => {
        const teamIds = new Set(data.teams.map(t => t.id));
        const filtered = d.pins.filter(p => {
          const tid = p.metadata?.teamId;
          return typeof tid === 'string' && teamIds.has(tid);
        });
        setAwards(filtered);
        setLoading(false);
      })
      .catch(() => { setAwards([]); setLoading(false); });
  }, [data.league.seasonId, data.teams]);

  if (loading) return <div className="text-text-muted text-sm py-12 text-center">Loading awards…</div>;
  if (!awards || awards.length === 0) {
    return (
      <div className="text-text-muted text-sm py-12 text-center italic">
        No awards minted yet. Use the admin Season Wizard to archive this season and mint pins.
      </div>
    );
  }

  // Group by pin def so each award type has its own card with all recipients.
  const byDef = new Map<string, { def: SeasonAward; pins: SeasonAward[] }>();
  for (const p of awards) {
    if (!byDef.has(p.pinDefId)) byDef.set(p.pinDefId, { def: p, pins: [] });
    byDef.get(p.pinDefId)!.pins.push(p);
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {[...byDef.values()].map(({ def, pins }) => (
        <AwardCard key={def.pinDefId} def={def} pins={pins} teams={data.teams} />
      ))}
    </div>
  );
}

function AwardCard({
  def, pins, teams,
}: {
  def: SeasonAward;
  pins: SeasonAward[];
  teams: FullLeagueData['teams'];
}) {
  const teamById = new Map(teams.map(t => [t.id, t]));

  // Resolve the lucide icon by name; fall back to Award if missing.
  const IconComp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>>)[def.defIconName]
    ?? Icons.Award;

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      <div className="h-1" style={{ backgroundColor: def.defColor }} />
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div
            className="rounded-lg p-1.5 shrink-0"
            style={{ backgroundColor: `${def.defColor}1A`, border: `1px solid ${def.defColor}33` }}
          >
            <IconComp size={14} style={{ color: def.defColor }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{def.defName}</div>
            <div className="text-[10px] text-text-muted line-clamp-2">{def.defDescription}</div>
          </div>
          {def.defIsAuto && (
            <Badge variant="outline" className="text-[8px] uppercase border-border-default text-text-muted">
              Auto
            </Badge>
          )}
        </div>

        <div className="space-y-1 pt-1 border-t border-border-subtle">
          {pins.map(p => {
            const team = p.metadata?.teamId ? teamById.get(p.metadata.teamId) : null;
            // Build a one-line metadata caption from common fields.
            const metaCaption = formatMetaCaption(p.metadata);
            return (
              <div key={p.pinId} className="flex items-center gap-2 text-[11px]">
                {team && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: team.teamColor }}
                  />
                )}
                <Link
                  to={`/coach/${p.username}`}
                  className="font-medium text-text-primary hover:text-neon hover:underline truncate"
                >
                  {p.displayName ?? p.username}
                </Link>
                {team && (
                  <span className="text-text-muted text-[10px] truncate">· {team.teamAbbrev}</span>
                )}
                {metaCaption && (
                  <span className={cn('font-mono text-[10px] text-text-muted ml-auto shrink-0')}>
                    {metaCaption}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function formatMetaCaption(meta: any): string | null {
  if (!meta || typeof meta !== 'object') return null;
  // Award-specific captions in priority order. Each new auto pin gets its
  // own line here; ordering reflects what the user reads first.
  if (meta.kills != null && meta.cost != null && meta.ratio != null) {
    // steal-of-the-draft
    return `${meta.pokemon ?? ''} ${meta.kills}K @ ${meta.cost}pt`;
  }
  if (meta.sweeps != null) return `${meta.sweeps} sweep${meta.sweeps === 1 ? '' : 's'}`;
  if (meta.kills != null && meta.matchId) return `${meta.pokemon ?? ''} ${meta.kills}K`;
  if (meta.streak != null) return `${meta.streak}-game streak`;
  if (meta.wins != null && meta.losses != null) return `${meta.wins}-${meta.losses}, ${meta.diff > 0 ? '+' : ''}${meta.diff}`;
  if (meta.seriesScore) return meta.seriesScore;
  return null;
}
