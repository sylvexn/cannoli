/**
 * Team trophy case - a team's published pins for the CURRENT season, read
 * from the team itself (`getTeamPins`), so unlinked teams show their awards
 * too. Renders nothing when there are none, to avoid an empty card on every
 * mundane team page.
 */
import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api, type ApiPin } from '@/lib/api';
import { Pin } from '@/components/pin';
import type { Player } from '@/lib/types';

interface PinsTrophyCaseProps {
  player: Player;
  leagueId: string;
  /** Numeric season id (LeagueSeason.id, typed string on the frontend but
   *  numeric at the wire level) — compared against pin.seasonId. */
  seasonId: string;
}

export function PinsTrophyCase({ player, leagueId, seasonId }: PinsTrophyCaseProps) {
  const [pins, setPins] = useState<ApiPin[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.getTeamPins(player.id).then(all => {
      if (!cancelled) setPins(all);
    }).catch(() => { if (!cancelled) setPins([]); });
    return () => { cancelled = true; };
  }, [player.id]);

  const seasonNum = Number(seasonId);
  const teamPins = pins.filter(p => {
    if (p.seasonId !== seasonNum) return false;
    return p.leagueId == null || p.leagueId === leagueId;
  });

  if (teamPins.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-border-default bg-surface-raised p-4"
      style={{ ['--card-accent' as never]: player.teamColor }}
    >
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3 flex items-center gap-1.5">
        <Trophy size={12} className="text-amber-400" />
        Trophies
      </h2>
      <div className="flex flex-wrap gap-3">
        {teamPins.map(pin => (
          <Pin
            key={pin.id}
            def={pin.definition}
            size="lg"
            seasonNumber={pin.seasonNumber}
            leagueId={pin.leagueId}
            metadata={pin.metadata}
          />
        ))}
      </div>
    </div>
  );
}
