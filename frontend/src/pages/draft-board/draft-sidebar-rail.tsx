import { cn } from '@/lib/utils';
import { TeamLogo } from '@/components/team-logo';
import { Button } from '@/components/ui/button';
import { Pin, PinOff, Eye } from 'lucide-react';
import type { Player } from '@/lib/types';
import type { DraftPresenceData } from './use-draft-websocket';

interface DraftSidebarRailProps {
  /** Display order — user's team first when in live mode (parent decides order). */
  teamOrder: Player[];
  /** Selected team id (if any). */
  selectedTeamId: string | null;
  /** Click handler — opens the overlay drawer (or selects the team). */
  onSelectTeam: (teamId: string) => void;
  /** Hover/click on the rail body opens the floating panel. */
  onOpen: () => void;
  /** Currently-drafting team id — pulses in live mode. */
  currentDrafterId?: string | null;
  /** Whether we're in live draft mode (changes accents + presence dots). */
  isLiveMode?: boolean;
  /** The user's team id — gets a permanent ring marker. */
  userTeamId?: string | null;
  /** Presence (live online dots) */
  presence?: DraftPresenceData;
  /** Pin/unpin toggle (only relevant on the largest breakpoint). */
  pinned?: boolean;
  onTogglePin?: () => void;
}

/**
 * Mini vertical rail of team logos. Lives at the right edge of the pool;
 * tapping or hovering opens the floating overlay drawer that wraps
 * `DraftSidebarPanel`. On the largest breakpoint a Pin button toggles
 * between this rail and a permanently docked panel.
 */
export function DraftSidebarRail({
  teamOrder, selectedTeamId, onSelectTeam, onOpen,
  currentDrafterId, isLiveMode, userTeamId, presence,
  pinned, onTogglePin,
}: DraftSidebarRailProps) {
  const connectedTeamIds = new Set(presence?.players.map(p => p.teamId) ?? []);

  return (
    <div
      className="w-[52px] shrink-0 bg-surface-raised border-l border-border-default flex flex-col items-center py-2 gap-1 group/rail"
      onMouseEnter={onOpen}
    >
      {onTogglePin && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePin}
          className="h-7 w-7 p-0 text-text-muted hover:text-neon mb-1"
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar open'}
          aria-pressed={!!pinned}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </Button>
      )}
      {teamOrder.map(p => {
        const isUser = userTeamId === p.id;
        const isDrafter = currentDrafterId === p.id;
        const isSelected = selectedTeamId === p.id;
        const isOnline = connectedTeamIds.has(p.id);
        return (
          <button
            key={p.id}
            onClick={() => { onSelectTeam(p.id); onOpen(); }}
            className={cn(
              'relative h-9 w-9 flex items-center justify-center rounded-full transition-all duration-150',
              'hover:scale-110',
              isSelected && 'ring-1 ring-neon',
              isDrafter && 'ring-1 ring-pink animate-pulse',
              isUser && 'ring-1 ring-neon/40',
            )}
            aria-label={`${p.teamAbbrev}${isUser ? ' (your team)' : ''}${isDrafter ? ' (on the clock)' : ''}`}
          >
            <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
            {isLiveMode && (
              <span
                className={cn(
                  'absolute -bottom-0 -right-0 w-1.5 h-1.5 rounded-full ring-1 ring-surface-raised',
                  isOnline ? 'bg-win' : 'bg-loss/60',
                )}
                aria-hidden
              />
            )}
          </button>
        );
      })}
      {presence && presence.spectators.length > 0 && (
        <div className="mt-auto pt-1 border-t border-border-subtle w-full flex flex-col items-center gap-0.5 text-[9px] font-mono text-text-muted/70">
          <Eye size={10} />
          <span className="tabular-nums">{presence.spectators.length}</span>
        </div>
      )}
    </div>
  );
}
