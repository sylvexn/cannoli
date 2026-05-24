import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  LayoutGrid, Table, History, Radio, Wifi, Loader2, ScrollText,
  Volume2, VolumeX, FlaskConical, Zap, Rows3, Rows2, StretchHorizontal,
} from 'lucide-react';
import { SegmentedToggle } from './segmented-toggle';
import type { CardDensity } from './pokemon-compact-card';
import type { DraftView, DraftState, DraftAction } from './types';
import type { Dispatch } from 'react';

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

/** Top chrome strip for the draft board: title, view toggle, connection
 *  badge, pick-count toggle, mute button + one-time hint, density selector,
 *  and grid/table view toggle. Extracted from draft-board.tsx to keep the
 *  page file under the 600-LOC limit. */
export function DraftTopBar({
  state, dispatch, isPractice, draftDemoVisible, isDraftRunning, isDraftComplete,
  leagueId, wsConnected,
  pickLogExpanded, onTogglePickLog,
  muted, onToggleMuted, hintVisible,
  density, onChangeDensity,
}: DraftTopBarProps) {
  const viewToggleValue: DraftView = state.view;

  return (
    <div className="flex items-center justify-between gap-3 pb-1.5 shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
          <span className="text-draw">Draft</span>
          <span className="text-text-primary ml-1">Board</span>
          {isPractice && (
            <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-pink/80 align-middle">
              Practice
            </span>
          )}
        </h1>
        <Link
          to="/rules"
          className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-pink transition-colors"
        >
          <ScrollText size={11} />
          Rules
        </Link>
        {/* Practice link — gated by admin draftDemoVisible setting. Hidden when
            we're already on the practice route. */}
        {!isPractice && draftDemoVisible && (
          <Link
            to={`/league/${leagueId}/draft/practice`}
            className="hidden md:inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-pink transition-colors"
            title="Open the client-side practice draft"
          >
            <FlaskConical size={11} />
            Practice
          </Link>
        )}
        {/* Practice route exposes only the active view (simulator); we hide
            the History/Live toggle so users don't accidentally land in
            read-only history while testing. */}
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
          <Badge
            variant="outline"
            className="text-[10px] gap-1.5 px-2 py-0.5 font-mono text-pink border-pink/30 bg-pink/10"
          >
            <Zap size={10} />
            Simulator
          </Badge>
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
                <Wifi size={10} />
                Connected
              </>
            ) : (
              <>
                <Loader2 size={10} className="animate-spin" />
                Connecting...
              </>
            )}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Recent picks toggle (inline badge) */}
        {isDraftRunning && state.allPicks.length > 0 && !isDraftComplete && (
          <button
            onClick={onTogglePickLog}
            className={cn(
              'text-[10px] font-mono px-2 py-0.5 rounded border transition-colors',
              pickLogExpanded
                ? 'text-neon border-neon/30 bg-neon/5'
                : 'text-text-muted border-border-subtle hover:text-text-secondary',
            )}
          >
            {state.allPicks.length} picks
          </button>
        )}

        {isDraftRunning && (
          <div className="relative">
            <button
              onClick={onToggleMuted}
              title={muted ? 'Cries muted — click to unmute' : 'Cries on — click to mute'}
              aria-label={muted ? 'Unmute pick cries' : 'Mute pick cries'}
              aria-pressed={muted}
              className={cn(
                'h-6 w-6 inline-flex items-center justify-center rounded border transition-colors',
                muted
                  ? 'text-text-muted border-border-subtle hover:text-text-secondary'
                  : 'text-neon border-neon/30 bg-neon/5 hover:bg-neon/10',
              )}
            >
              {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
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
                <Volume2 size={10} className="text-neon shrink-0" />
                Sound on — click to mute
              </div>
            )}
          </div>
        )}
        {state.viewMode === 'grid' && (
          <SegmentedToggle
            value={density}
            onChange={onChangeDensity}
            size="sm"
            options={[
              { value: 'compact', label: '', icon: <Rows3 size={13} />, title: 'Compact (sprites only)' },
              { value: 'comfortable', label: '', icon: <Rows2 size={13} />, title: 'Comfortable (default)' },
              { value: 'detailed', label: '', icon: <StretchHorizontal size={13} />, title: 'Detailed (larger sprite + types)' },
            ]}
          />
        )}
        <SegmentedToggle
          value={state.viewMode}
          onChange={mode => dispatch({ type: 'SET_VIEW_MODE', mode })}
          options={[
            { value: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
            { value: 'table', label: 'Table', icon: <Table size={13} /> },
          ]}
        />
      </div>
    </div>
  );
}
