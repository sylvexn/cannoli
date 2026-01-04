import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { RecordDisplay } from '@/components/record-display';
import { PointCapBar } from '@/components/point-cap-bar';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import type { Player } from '@/lib/types';
import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TeamPopoverProps {
  player: Player;
  children: React.ReactNode;
}

export function TeamPopover({ player, children }: TeamPopoverProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const pointsUsed = player.roster.reduce((sum, p) => sum + p.tier, 0);
  const hasRoster = player.roster.length > 0;

  const show = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({
          top: rect.top,
          left: rect.right + 10,
        });
      }
      setOpen(true);
    }, 200);
  }, []);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const adjustedTop = Math.min(coords.top, window.innerHeight - 420);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className="cursor-pointer"
      >
        {children}
      </span>

      {open && createPortal(
        <div
          ref={cardRef}
          onMouseEnter={show}
          onMouseLeave={hide}
          className="fixed z-50 w-80 rounded-lg bg-surface-raised border border-border-default animate-in fade-in-0 zoom-in-95 duration-150"
          style={{
            top: Math.max(8, adjustedTop),
            left: coords.left,
            boxShadow: '0 0 20px rgba(34, 211, 238, 0.1), 0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 p-3 border-b border-border-subtle rounded-t-lg"
            style={{ background: `linear-gradient(135deg, ${player.teamColor}10, transparent)` }}
          >
            <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-text-primary truncate">{player.teamName}</div>
              <div className="text-xs text-text-muted">{player.name} &middot; {player.teamAbbrev}</div>
              <div className="mt-1">
                <RecordDisplay
                  wins={player.record.wins}
                  losses={player.record.losses}
                  differential={player.record.differential}
                  className="text-sm"
                />
              </div>
            </div>
          </div>

          {hasRoster ? (
            <>
              {/* Pokemon sprite grid — 6 per row in tubes */}
              <div className="px-3 pt-3 pb-2 space-y-1.5">
                {Array.from({ length: Math.ceil(player.roster.length / 6) }, (_, row) => {
                  const rowMons = player.roster.slice(row * 6, (row + 1) * 6);
                  return (
                    <div
                      key={row}
                      className="flex items-center justify-center gap-1 px-2 py-1 rounded-full bg-surface-overlay/60 border border-border-subtle"
                    >
                      {rowMons.map(mon => (
                        <div key={mon.name} className="relative group">
                          <PokemonSprite name={mon.name} size="sm" className="transition-transform duration-150 group-hover:scale-125" />
                          {mon.isTeraCaptain && (
                            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-pink shadow-glow-pink-sm" />
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Roster list */}
              <div className="px-2 pb-2 space-y-px font-mono">
                {player.roster.map(mon => (
                  <div key={mon.name} className="flex items-center gap-1.5 py-1.5 px-2 rounded hover:bg-surface-overlay/60 transition-colors">
                    <TierBadge points={mon.tier} className="shrink-0" />
                    <PokemonSprite name={mon.name} size="xs" className="shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-1">
                      <span className={`text-[11px] font-semibold truncate ${mon.isTeraCaptain ? 'text-pink' : 'text-text-primary'}`}>
                        {mon.name}
                      </span>
                      {mon.isTeraCaptain && (
                        <span className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-pink/20 text-pink text-[8px] font-black leading-none border border-pink/40">
                          T
                        </span>
                      )}
                    </div>
                    <TypeChip types={mon.types} size="xs" className="shrink-0" />
                  </div>
                ))}
              </div>

              {/* Point cap */}
              <div className="px-3 pb-3 pt-1 border-t border-border-subtle">
                <PointCapBar used={pointsUsed} />
              </div>
            </>
          ) : (
            <div className="p-6 text-center text-xs text-text-muted">
              Roster data not loaded
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
