import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { PointCapBar } from '@/components/point-cap-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ChevronRight, ArrowRightLeft, Zap, AlertTriangle, X,
  ListOrdered, Circle, Eye, Crown, Sparkles, Pin, PinOff,
} from 'lucide-react';
import type { Player } from '@/lib/types';
import type { Acquisition } from './types';
import type { DraftPresenceData } from './use-draft-websocket';
import { getTierEntry } from '@/data/tier-list';
import { captainHeadroomNeeded } from '@/lib/draft-rules';
import { ViewTransitionShim } from './use-pick-animation-queue';

/** Matches the unified Phase 2 VT name pattern. The same name is stamped on
 *  the pool card while it's animating so the browser pairs old/new snapshots
 *  and morphs the sprite from the grid into the roster slot. */
function pickViewTransitionName(name: string): string {
  return `pokemon-card-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export interface DraftSidebarPanelProps {
  /** Players in display order (draft order during draft, standings after) */
  teamOrder: Player[];
  teamRosters: Map<string, { name: string; tier: number; acquisition: Acquisition; nickname?: string | null }[]>;
  teamPoints: Map<string, number>;
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string | null) => void;
  /** Current drafter's team ID (live mode only) */
  currentDrafterId?: string | null;
  /** Whether we're in live draft mode */
  isLiveMode?: boolean;
  /** The user's team ID (for focused panel in draft mode) */
  userTeamId?: string | null;
  /** Point cap for the league */
  pointCap?: number;
  /** Tera captain slots configured for this league (for headroom hint) */
  teraCaptainSlots?: number;
  /** Roster size for picks-left math */
  rosterSize?: number;
  /** User's draft queue (max 3 Pokemon names) */
  draftQueue?: string[];
  onQueueRemove?: (name: string) => void;
  autoDraftQueue?: boolean;
  onToggleAutoDraft?: () => void;
  /** Manually draft the top queued Pokemon */
  onDraftFromQueue?: () => void;
  isUserTurn?: boolean;
  /** Live presence data from WebSocket */
  presence?: DraftPresenceData;
  /** Pokemon name currently being celebrated by the pick animation queue.
   *  The matching roster row wraps in <ViewTransition name="..."> so React
   *  can morph the sprite from the pool card into this slot. */
  animatingPokemonName?: string | null;
  /** Optional close affordance (drawer/overlay shells inject one). When
   *  omitted the panel renders without a chevron in its header. */
  onClose?: () => void;
  /** Optional pin/unpin toggle (only relevant on the largest breakpoint). */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** When the panel is rendered as a floating drawer (not pinned), apply a
   *  shadow + match-edge styling. */
  floating?: boolean;
}

const DEFAULT_ROSTER_SIZE = 10;

/**
 * The actual sidebar content (team list + your-team panel + queue + budget cue
 * + presence). Pure render given props — used by all three breakpoint shells:
 * pinned, overlay drawer, and bottom sheet.
 */
export function DraftSidebarPanel(props: DraftSidebarPanelProps) {
  const {
    teamOrder, teamRosters, teamPoints, selectedTeamId, onSelectTeam,
    currentDrafterId, isLiveMode, userTeamId,
    pointCap = 110, teraCaptainSlots = 2, rosterSize = DEFAULT_ROSTER_SIZE,
    draftQueue = [], onQueueRemove, autoDraftQueue, onToggleAutoDraft,
    onDraftFromQueue, isUserTurn, presence, animatingPokemonName,
    onClose, pinned, onTogglePin, floating,
  } = props;

  const connectedTeamIds = new Set(presence?.players.map(p => p.teamId) ?? []);

  const userPlayer = userTeamId ? teamOrder.find(p => p.id === userTeamId) : undefined;
  const userPoints = userPlayer ? teamPoints.get(userPlayer.id) ?? 0 : 0;
  const userRoster = userPlayer ? teamRosters.get(userPlayer.id) ?? [] : [];
  const remaining = pointCap - userPoints;
  const picksLeft = Math.max(0, rosterSize - userRoster.length);
  const avgPerPick = picksLeft > 0 ? remaining / picksLeft : 0;
  const captainReserve = isLiveMode && userPlayer
    ? captainHeadroomNeeded(userRoster, teraCaptainSlots)
    : 0;
  const captainBudgetWarning = captainReserve > 0 && remaining < captainReserve;

  // Place user's team at the top during live mode
  const orderedTeams = isLiveMode && userTeamId
    ? [userPlayer!, ...teamOrder.filter(p => p.id !== userTeamId)].filter(Boolean) as Player[]
    : teamOrder;

  return (
    <div
      className={cn(
        'flex flex-col h-full min-h-0 bg-surface-raised border-l border-border-default',
        floating && 'shadow-[-6px_0_18px_rgba(0,0,0,0.4)]',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <span className="text-xs font-heading font-semibold text-text-primary">Teams</span>
          {isLiveMode && (
            <Badge className="bg-pink/10 text-pink border border-pink/30 text-[9px] h-4 px-1.5 font-mono">DRAFT</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {presence && presence.spectators.length > 0 && (
            <span className="text-[9px] font-mono text-text-muted/70 flex items-center gap-1">
              <Eye size={10} />
              {presence.spectators.length}
            </span>
          )}
          {onTogglePin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTogglePin}
              className="h-6 w-6 p-0 text-text-muted hover:text-neon"
              aria-label={pinned ? 'Unpin sidebar (will float on hover)' : 'Pin sidebar open'}
              aria-pressed={pinned}
              title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
            >
              {pinned ? <Pin size={13} /> : <PinOff size={13} />}
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 text-text-muted hover:text-neon"
              aria-label="Close team panel"
            >
              <ChevronRight size={14} />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {/* Live mode: budget cue + queue, anchored under the user's team row */}
        {orderedTeams.map((p, idx) => {
          const isUser = isLiveMode && p.id === userTeamId;
          const isFirst = idx === 0;
          const isDrafter = currentDrafterId === p.id;
          const isSelected = selectedTeamId === p.id;
          const points = teamPoints.get(p.id) ?? 0;
          const roster = teamRosters.get(p.id) ?? [];
          const isOnline = connectedTeamIds.has(p.id);
          const showOnline = !!isLiveMode;

          return (
            <div key={p.id}>
              {isLiveMode && isUser && idx === 0 && (
                <div className="px-3 pt-2 pb-1.5 border-b border-border-subtle">
                  <span className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-wider">
                    Your Draft
                  </span>
                </div>
              )}
              {!isLiveMode && isFirst && (
                <div className="px-3 pt-2 pb-1.5 border-b border-border-subtle">
                  <span className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-wider">
                    Teams
                  </span>
                </div>
              )}
              {/* Section header for "Other teams" appears once after the user's row in live mode */}
              {isLiveMode && idx === 1 && (
                <div className="px-3 py-1.5 border-y border-border-subtle bg-surface-overlay/20 flex items-center gap-2">
                  <span className="text-[10px] font-heading font-semibold text-text-muted uppercase tracking-wider">
                    Draft Order
                  </span>
                  {presence && presence.players.length > 0 && (
                    <span className="text-[9px] font-mono text-text-muted/60 ml-auto">
                      {[...connectedTeamIds].filter(id => id !== userTeamId).length}/{orderedTeams.length - 1} online
                    </span>
                  )}
                </div>
              )}

              <UnifiedTeamRow
                player={p}
                points={points}
                roster={roster}
                pointCap={pointCap}
                isUser={isUser}
                isDrafter={isDrafter}
                isSelected={isSelected}
                onSelect={() => onSelectTeam(isSelected ? null : p.id)}
                isOnline={isOnline}
                showOnline={showOnline}
                expanded={isUser /* user's row stays expanded */ || isSelected}
                forceExpand={isUser}
                animatingPokemonName={animatingPokemonName}
              />

              {/* Live-only sections inline under the user's row */}
              {isLiveMode && isUser && (
                <>
                  {/* Budget cue / picks-left math */}
                  {picksLeft > 0 && (
                    <div className="px-3 pb-2">
                      <div className={cn(
                        'flex items-center justify-between gap-2 px-2 py-1 rounded text-[10px] font-mono',
                        avgPerPick <= 2
                          ? 'bg-loss/10 border border-loss/20 text-loss'
                          : avgPerPick <= 4
                          ? 'bg-draw/10 border border-draw/20 text-draw'
                          : 'bg-surface-overlay/40 text-text-muted',
                      )}>
                        <span>~<span className="font-bold">{avgPerPick.toFixed(1)}</span>pt/pick</span>
                        <span className="text-text-muted/60">{picksLeft} picks left</span>
                        {avgPerPick <= 2 && <AlertTriangle size={10} aria-label="Low budget per pick" />}
                      </div>
                      {captainReserve > 0 && (
                        <div className={cn(
                          'mt-1 flex items-center justify-between px-2 py-1 rounded text-[10px] font-mono',
                          captainBudgetWarning
                            ? 'bg-loss/10 border border-loss/20 text-loss'
                            : 'bg-surface-overlay/30 text-text-muted',
                        )}>
                          <span className="flex items-center gap-1">
                            <Crown size={10} />
                            captain reserve: <span className="font-bold">{captainReserve}pt</span>
                          </span>
                          {captainBudgetWarning && (
                            <AlertTriangle
                              size={10}
                              aria-label="Not enough headroom to designate the configured number of captains at worst-case markup"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Draft queue */}
                  {draftQueue.length > 0 && (
                    <div className="px-3 pb-2 border-b border-border-subtle">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ListOrdered size={11} className="text-pink" />
                        <span className="text-[10px] font-heading font-semibold text-text-muted uppercase">Queue</span>
                        <span className="text-[9px] font-mono text-text-muted/60 ml-auto">{draftQueue.length}/3</span>
                      </div>
                      <div className="space-y-0.5">
                        {draftQueue.map((name, qi) => {
                          const tierEntry = getTierEntry(name);
                          return (
                            <div key={name} className="flex items-center gap-1.5 py-0.5 px-1 rounded bg-pink/5 border border-pink/15 group/q">
                              <span className="text-[9px] font-mono tabular-nums text-pink/60 w-3 shrink-0 text-right">{qi + 1}</span>
                              <PokemonSprite name={name} size="xs" />
                              <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">{name}</span>
                              {tierEntry && <TierBadge points={tierEntry.tier} />}
                              {onQueueRemove && (
                                <button
                                  onClick={() => onQueueRemove(name)}
                                  className="opacity-0 group-hover/q:opacity-100 p-0.5 rounded text-text-muted hover:text-loss transition-all"
                                  aria-label={`Remove ${name} from queue`}
                                >
                                  <X size={10} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {onToggleAutoDraft && (
                        <button
                          onClick={onToggleAutoDraft}
                          className={cn(
                            'mt-2 w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] font-medium transition-all border',
                            autoDraftQueue
                              ? 'bg-pink/10 border-pink/30 text-pink'
                              : 'bg-surface-overlay/30 border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary',
                          )}
                          aria-pressed={!!autoDraftQueue}
                        >
                          <div className={cn(
                            'w-6 h-3.5 rounded-full transition-colors relative flex-shrink-0',
                            autoDraftQueue ? 'bg-pink' : 'bg-surface-overlay',
                          )}>
                            <div className={cn(
                              'absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all',
                              autoDraftQueue ? 'left-3' : 'left-0.5',
                            )} />
                          </div>
                          <span>Auto-draft from queue</span>
                        </button>
                      )}
                      {!autoDraftQueue && isUserTurn && onDraftFromQueue && (
                        <button
                          onClick={onDraftFromQueue}
                          className={cn(
                            'group/qd mt-1.5 w-full relative overflow-hidden',
                            'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md',
                            'bg-gradient-to-r from-pink/20 via-neon/20 to-pink/20',
                            'border border-pink/30 hover:border-neon/50',
                            'transition-all duration-300',
                            'hover:shadow-[0_0_16px_rgba(232,121,249,0.2)]',
                          )}
                          aria-label={`Draft ${draftQueue[0]} from queue`}
                        >
                          <Sparkles size={12} className="text-neon" />
                          <span className="text-[11px] font-bold text-text-primary">Draft #{1}</span>
                          <span className="text-[10px] text-text-muted truncate max-w-[100px]">{draftQueue[0]}</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}

// ─── Unified team row template ─────────────────────────────────────────────

interface UnifiedTeamRowProps {
  player: Player;
  points: number;
  roster: { name: string; tier: number; acquisition: Acquisition; nickname?: string | null }[];
  pointCap: number;
  isUser?: boolean;
  isDrafter?: boolean;
  isSelected?: boolean;
  onSelect: () => void;
  isOnline?: boolean;
  showOnline?: boolean;
  /** Visual expansion (roster shown). User's row always expanded; others on selection. */
  expanded?: boolean;
  /** When true the click toggles only inspection elsewhere — row never collapses */
  forceExpand?: boolean;
  /** Pokemon name currently animating — wraps the matching roster row in
   *  ViewTransition so the sprite morphs into the slot. */
  animatingPokemonName?: string | null;
}

function UnifiedTeamRow({
  player, points, roster, pointCap, isUser, isDrafter, isSelected,
  onSelect, isOnline, showOnline, expanded, forceExpand, animatingPokemonName,
}: UnifiedTeamRowProps) {
  const remaining = pointCap - points;
  const showRoster = !!expanded;

  return (
    <div className={cn(
      'relative border-b border-border-subtle/60',
      isUser && 'bg-gradient-to-r from-neon/[0.05] via-neon/[0.015] to-transparent',
      isDrafter && !isUser && 'bg-pink/5',
    )}>
      {/* Side accent for user / drafter */}
      {(isUser || isDrafter) && (
        <div
          className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-md"
          style={{ backgroundColor: isUser ? player.teamColor : 'var(--color-pink)' }}
        />
      )}

      <button
        onClick={forceExpand ? () => onSelect() : onSelect}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 transition-colors text-left',
          'hover:bg-surface-overlay/30',
        )}
      >
        {showOnline && (
          <Circle size={5} className={cn('shrink-0', isOnline ? 'fill-win text-win' : 'fill-loss/60 text-loss/60')} />
        )}
        <TeamLogo abbrev={player.teamAbbrev} color={player.teamColor} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn('text-xs font-medium truncate', isUser ? 'text-text-primary' : 'text-text-secondary')}>
              {player.teamAbbrev}
            </span>
            {isUser && <Crown size={9} className="text-neon shrink-0" aria-label="Your team" />}
            {isDrafter && (
              <Badge className="bg-pink/20 text-pink border-pink/30 text-[8px] h-3.5 px-1 py-0 font-mono">
                <Zap size={7} className="mr-0.5" aria-hidden />OTC
              </Badge>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono tabular-nums text-text-muted shrink-0">
          {points}<span className="text-text-muted/40">/{pointCap}</span>
        </span>
        <span className="text-[9px] font-mono text-text-muted/60 w-7 text-right shrink-0 tabular-nums">
          {roster.length}pk
        </span>
      </button>

      {/* Inline budget bar — visible always for the user, on selection for others */}
      {(isUser || (isSelected && roster.length > 0)) && (
        <div className="px-3 pb-1.5">
          <PointCapBar used={points} total={pointCap} />
          {isUser && (
            <div className="flex justify-between text-[9px] font-mono text-text-muted mt-1">
              <span>{points}/{pointCap}</span>
              <span className={cn(
                'font-bold',
                remaining < 10 ? 'text-loss' : remaining < 20 ? 'text-draw' : 'text-neon',
              )}>
                {remaining}pt left
              </span>
            </div>
          )}
        </div>
      )}

      {/* Roster expansion */}
      {showRoster && (
        <div className="px-3 pb-2 space-y-0.5">
          {roster.length > 0 ? roster.map((mon, i) => {
            const row = (
              <div className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-surface-overlay/40">
                <span className="text-[9px] font-mono tabular-nums text-text-muted/50 w-3 shrink-0 text-right">{i + 1}</span>
                <PokemonSprite name={mon.name} size="xs" />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[11px] text-text-primary truncate leading-tight">{mon.name}</span>
                  {mon.nickname ? (
                    <span className="italic text-text-muted text-[9px] truncate leading-tight" title={mon.nickname}>
                      "{mon.nickname}"
                    </span>
                  ) : null}
                </div>
                {mon.acquisition.method === 'traded' && (
                  <ArrowRightLeft size={10} className="text-pink shrink-0" aria-label="Traded" />
                )}
                <TierBadge points={mon.tier} />
              </div>
            );
            // Wrap only the row matching the currently-animating pick. The
            // pool card with the same view-transition-name is unmounting in
            // the same commit; React pairs them and morphs the sprite.
            if (animatingPokemonName === mon.name) {
              return (
                <ViewTransitionShim
                  key={mon.name}
                  name={pickViewTransitionName(mon.name)}
                  className="pokemon-card-vt"
                >
                  {row}
                </ViewTransitionShim>
              );
            }
            return <Fragment key={mon.name}>{row}</Fragment>;
          }) : (
            <div className="text-[10px] text-text-muted py-1 text-center">No picks yet</div>
          )}
        </div>
      )}
    </div>
  );
}
