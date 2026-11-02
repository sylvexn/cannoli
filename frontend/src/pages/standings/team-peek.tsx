import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoach } from '@/components/team-coach';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeraIndicator } from '@/components/tera-indicator';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { useLeagueUrl } from '@/lib/use-league-url';
import { slabColor } from '@/lib/color';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';

/** Right-side team peek. Always mounted; slides in via transform. */
export function TeamPeek({ player, open, rank, onClose }: { player: Player | null; open: boolean; rank: number; onClose: () => void }) {
  const leagueUrl = useLeagueUrl();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const diff = player?.record.differential ?? 0;
  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn('fixed inset-0 z-50 bg-black/50 transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0 pointer-events-none')}
      />
      <aside
        aria-hidden={!open}
        inert={!open}
        aria-label="Team peek"
        className={cn(
          'fixed right-0 top-0 z-50 h-dvh w-full max-w-[420px] flex flex-col bg-surface-raised border-l border-border-default',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {player && (
          <>
            <div
              className="relative flex items-center gap-3 p-4 border-b border-border-subtle"
              style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${slabColor(player.teamColor)} 45%, transparent), transparent)` }}
            >
              <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} logoPath={player.logoPath} className="!w-14 !h-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <Link to={leagueUrl(`/teams/${player.id}`)} className="block truncate font-display text-xl leading-tight text-text-primary hover:underline">
                  {player.teamName}
                </Link>
                <TeamCoach player={player} size="xs" showAvatar avatarSize="sm" />
                <div className="font-mono text-xs text-text-secondary tabular-nums mt-0.5">
                  {player.record.wins}–{player.record.losses} · #{rank} · KO {diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : '0'}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-2 right-2 grid place-items-center size-7 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay/60"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
              {player.roster.length === 0 && <p className="py-6 text-sm text-text-muted text-center">No roster yet.</p>}
              {player.roster.map(mon => (
                <div key={mon.name} className="flex items-center gap-2 h-[38px] border-b border-border-subtle last:border-b-0">
                  <PokemonSprite name={mon.name} size="xs" />
                  <TeraIndicator
                    name={mon.name}
                    isTeraCaptain={mon.isTeraCaptain}
                    teraTypes={mon.teraTypes}
                    className="text-sm truncate min-w-0 flex-1"
                    asLink
                  />
                  <TypeChip types={mon.types} size="xs" />
                  <TierBadge points={mon.tier} />
                  <span className="shrink-0 w-12 font-mono tabular-nums text-[11px] text-right">
                    <span className="text-win">{mon.seasonStats.kills}</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-loss">{mon.seasonStats.deaths}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border-subtle p-3">
              <Button className="w-full" nativeButton={false} render={<Link to={leagueUrl(`/teams/${player.id}`)} />}>
                Full team page
              </Button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
