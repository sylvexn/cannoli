import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  LayoutGrid, Table, History, Radio, Wifi, Loader2, ScrollText,
  Volume2, VolumeX, FlaskConical, Zap, Rows3, Rows2, StretchHorizontal,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { SegmentedToggle } from './segmented-toggle';
import type { CardDensity } from './pokemon-compact-card';
import type { DraftView, DraftState, DraftAction } from './types';
import type { Dispatch, ReactNode } from 'react';

interface DraftTopBarProps {
  state: DraftState;
  dispatch: Dispatch<DraftAction>;
  isPractice: boolean;
  draftDemoVisible: boolean;
  isDraftRunning: boolean;
  isDraftComplete: boolean;
  leagueId: string;
  wsConnected: boolean;

  // Pick log toggle
  pickLogExpanded: boolean;
  onTogglePickLog: () => void;

  // Cry mute
  muted: boolean;
  onToggleMuted: () => void;
  hintVisible: boolean;

  // Card density
  density: CardDensity;
  onChangeDensity: (d: CardDensity) => void;
}

/** Compact top chrome strip for the draft board. The visible row holds:
 *
 *   - Title block (split-color "Draft Board" mono) + kebab menu (Rules,
 *     Practice link).
 *   - Mode toggle (History / Live) — the most important top-bar control,
 *     stays prominent.
 *   - WS connection badge (live mode only).
 *   - Right cluster: pick-count, mute, view-mode, density. All 28×28 icon
 *     buttons separated by 1px dividers, each with a tooltip + aria-label.
 *
 * Goal: keep the row at ~28px tall and surface only 3 visible controls + the
 * kebab + the cluster.
 */
export function DraftTopBar({
  state, dispatch, isPractice, draftDemoVisible, isDraftRunning, isDraftComplete,
  leagueId, wsConnected,
  pickLogExpanded, onTogglePickLog,
  muted, onToggleMuted, hintVisible,
  density, onChangeDensity,
}: DraftTopBarProps) {
  const viewToggleValue: DraftView = state.view;
  const navigate = useNavigate();

  return (
    <TooltipProvider delay={300}>
      <div className="flex items-center justify-between gap-3 pb-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
            <span className="text-draw">Draft</span>
            <span className="text-text-primary ml-1">Board</span>
            {isPractice && (
              <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-pink/80 align-middle">
                Practice
              </span>
            )}
          </h1>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="h-7 w-7 inline-flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-overlay/40 transition-colors"
              aria-label="More draft options"
            >
              <MoreVertical size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-text-muted">
                  Draft
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate('/rules')} className="text-xs">
                  <ScrollText size={12} className="mr-2 text-text-muted" />
                  <span>Rules</span>
                </DropdownMenuItem>
                {!isPractice && draftDemoVisible && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/league/${leagueId}/draft/practice`)}
                      className="text-xs"
                    >
                      <FlaskConical size={12} className="mr-2 text-text-muted" />
                      <span>Practice draft</span>
                    </DropdownMenuItem>
                  </>
                )}
                {isPractice && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => navigate(`/league/${leagueId}/draft`)}
                      className="text-xs"
                    >
                      <Radio size={12} className="mr-2 text-text-muted" />
                      <span>Back to draft</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Hidden text link to /rules — keeps anchor semantics for assistive tech that
              skips dropdowns. The kebab is the visible affordance. */}
          <RouterLink to="/rules" className="sr-only">Rules</RouterLink>

          {/* Mode toggle (History/Live) — primary control, stays prominent. */}
          {!isPractice && (
            <SegmentedToggle
              value={viewToggleValue}
              onChange={view => dispatch({ type: 'SET_VIEW', view, source: 'server' })}
              options={[
                { value: 'history' as const, label: 'History', icon: <History size={13} />, activeClass: 'bg-neon/10 text-neon' },
                { value: 'active' as const, label: 'Live', icon: <Radio size={13} />, activeClass: 'bg-win/10 text-win' },
              ]}
            />
          )}
          {isPractice && (
            <Tooltip>
              <TooltipTrigger
                onClick={() => navigate(`/league/${leagueId}/draft`)}
                aria-label="Exit practice — back to draft"
                className={cn(
                  'inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[10px] font-mono',
                  'border border-pink/30 bg-pink/10 text-pink',
                  'hover:bg-pink/20 hover:border-pink/50 transition-colors',
                )}
              >
                <Zap size={10} aria-hidden />
                Simulator
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Click to exit practice and go back to the draft board
              </TooltipContent>
            </Tooltip>
          )}
          {!isPractice && state.view === 'active' && state.source === 'server' && (
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] gap-1.5 px-2 py-0.5 font-mono',
                wsConnected
                  ? 'text-win border-win/30 bg-win/10'
                  : 'text-draw border-draw/30 bg-draw/10',
              )}
            >
              {wsConnected ? (
                <>
                  <Wifi size={10} aria-hidden />
                  Connected
                </>
              ) : (
                <>
                  <Loader2 size={10} className="animate-spin" aria-hidden />
                  Connecting...
                </>
              )}
            </Badge>
          )}

          {/* Inline practice entry — surfaces the simulator from the top bar
              instead of burying it in the kebab. Only shown outside an
              active draft so it doesn't compete with live controls. */}
          {!isPractice && draftDemoVisible && !isDraftRunning && (
            <Tooltip>
              <TooltipTrigger
                onClick={() => navigate(`/league/${leagueId}/draft/practice`)}
                aria-label="Try a practice draft"
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10px] font-mono uppercase tracking-wider',
                  'border border-pink/30 bg-pink/10 text-pink',
                  'hover:bg-pink/20 hover:border-pink/50 transition-colors',
                )}
              >
                <FlaskConical size={11} aria-hidden />
                Practice
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Run a solo simulator draft to test strategy
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right cluster — segmented icon buttons, 28×28 each, hairline dividers. */}
        <div className="flex items-center rounded-md border border-border-default bg-surface-raised overflow-hidden divide-x divide-border-subtle">
          {/* Pick-count toggle (live mode only) */}
          {isDraftRunning && state.allPicks.length > 0 && !isDraftComplete && (
            <ClusterButton
              onClick={onTogglePickLog}
              active={pickLogExpanded}
              ariaLabel={pickLogExpanded ? 'Hide recent picks' : `Show ${state.allPicks.length} recent picks`}
              ariaPressed={pickLogExpanded}
              tooltip={pickLogExpanded ? 'Hide recent picks' : 'Show recent picks'}
            >
              <span className="text-[9px] font-mono tabular-nums leading-none px-0.5">
                {state.allPicks.length}
              </span>
            </ClusterButton>
          )}

          {/* Mute */}
          {isDraftRunning && (
            <div className="relative">
              <ClusterButton
                onClick={onToggleMuted}
                active={!muted}
                ariaLabel={muted ? 'Unmute pick cries' : 'Mute pick cries'}
                ariaPressed={muted}
                tooltip={muted ? 'Cries muted — click to unmute' : 'Cries on — click to mute'}
              >
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </ClusterButton>
              {hintVisible && (
                <div
                  role="status"
                  className={cn(
                    'absolute right-0 top-full mt-1.5 z-50 whitespace-nowrap',
                    'flex items-center gap-1.5 px-2 py-1 rounded-md border',
                    'border-neon/30 bg-surface-raised text-[10px] font-mono text-text-secondary',
                    'shadow-[0_0_10px_rgba(34,211,238,0.15)]',
                    'animate-in fade-in slide-in-from-top-1 duration-200',
                  )}
                >
                  <Volume2 size={10} className="text-neon shrink-0" aria-hidden />
                  Sound on — click to mute
                </div>
              )}
            </div>
          )}

          {/* View mode (Grid / Table) */}
          <ClusterButton
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', mode: state.viewMode === 'grid' ? 'table' : 'grid' })}
            ariaLabel={state.viewMode === 'grid' ? 'Switch to table view' : 'Switch to grid view'}
            tooltip={state.viewMode === 'grid' ? 'Switch to table view' : 'Switch to grid view'}
          >
            {state.viewMode === 'grid' ? <LayoutGrid size={13} /> : <Table size={13} />}
          </ClusterButton>

          {/* Density (compact / comfortable / detailed) — only meaningful in grid view */}
          {state.viewMode === 'grid' && (
            <ClusterDensity density={density} onChange={onChangeDensity} />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── Cluster button + density popout ──────────────────────────────────────

interface ClusterButtonProps {
  onClick: () => void;
  ariaLabel: string;
  tooltip: string;
  ariaPressed?: boolean;
  active?: boolean;
  children: ReactNode;
}

function ClusterButton({
  onClick, ariaLabel, tooltip, ariaPressed, active, children,
}: ClusterButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        className={cn(
          'h-7 w-7 inline-flex items-center justify-center transition-colors',
          active
            ? 'text-neon bg-neon/5 hover:bg-neon/10'
            : 'text-text-muted hover:text-text-primary hover:bg-surface-overlay/40',
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface ClusterDensityProps {
  density: CardDensity;
  onChange: (d: CardDensity) => void;
}

function ClusterDensity({ density, onChange }: ClusterDensityProps) {
  const Icon = density === 'compact' ? Rows3 : density === 'detailed' ? StretchHorizontal : Rows2;
  const label = density === 'compact' ? 'Compact' : density === 'detailed' ? 'Detailed' : 'Comfortable';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Card density: ${label}. Open density menu.`}
        title={`Card density: ${label}`}
        className="h-7 w-7 inline-flex items-center justify-center transition-colors text-text-muted hover:text-text-primary hover:bg-surface-overlay/40"
      >
        <Icon size={13} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-text-muted">
            Card density
          </DropdownMenuLabel>
          <DensityItem
            active={density === 'compact'}
            onClick={() => onChange('compact')}
            label="Compact"
            hint="Sprites only"
            icon={<Rows3 size={12} />}
          />
          <DensityItem
            active={density === 'comfortable'}
            onClick={() => onChange('comfortable')}
            label="Comfortable"
            hint="Default"
            icon={<Rows2 size={12} />}
          />
          <DensityItem
            active={density === 'detailed'}
            onClick={() => onChange('detailed')}
            label="Detailed"
            hint="Larger sprite + types"
            icon={<StretchHorizontal size={12} />}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DensityItem({
  active, onClick, label, hint, icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn(
        'text-xs flex items-center gap-2',
        active && 'text-neon',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-neon' : 'text-text-muted')}>{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="text-[9px] font-mono text-text-muted/70">{hint}</span>
    </DropdownMenuItem>
  );
}
