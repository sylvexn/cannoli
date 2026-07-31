/**
 * Team trophy case — most pins are earned by a TEAM (metadata.teamId /
 * pins.leagueId), but historically only ever rendered on the coach's
 * profile. This surfaces that team's pins for the CURRENT season right on
 * the team page.
 *
 * There's no dedicated "team pins" endpoint — we reuse the public
 * `getUserPins(username)` fetch (same one coach-profile/coach-link already
 * use) and filter client-side to this league + season. Renders nothing when
 * the team has no coach assigned or no pins yet, to avoid an empty-state
 * card on every mundane team page (the coach profile already has one).
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
  const username = player.owner?.username ?? null;

  useEffect(() => {
    if (!username) { setPins([]); return; }
    let cancelled = false;
    api.getUserPins(username).then(all => {
      if (!cancelled) setPins(all);
    }).catch(() => { if (!cancelled) setPins([]); });
    return () => { cancelled = true; };
  }, [username]);

  const seasonNum = Number(seasonId);
  const teamPins = pins.filter(p => {
    if (p.seasonId !== seasonNum) return false;
    if (p.leagueId) return p.leagueId === leagueId;
    // Legacy rows without a backfilled leagueId — fall back to the
    // team-headlined metadata shape (garchomp/champion/etc. all carry teamId).
    return p.metadata?.teamId === player.id;
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
            seasonId={pin.seasonId}
            leagueId={pin.leagueId}
            metadata={pin.metadata}
          />
        ))}
      </div>
    </div>
  );
}
