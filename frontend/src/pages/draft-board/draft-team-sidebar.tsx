import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { useMediaQuery } from '@/lib/use-media-query';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { DraftSidebarPanel, type DraftSidebarPanelProps } from './draft-sidebar-panel';
import { DraftSidebarRail } from './draft-sidebar-rail';
import type { Player } from '@/lib/types';

export type DraftTeamSidebarProps = Omit<DraftSidebarPanelProps, 'onClose' | 'pinned' | 'onTogglePin' | 'floating'>;

/**
 * Three-tier responsive shell around `DraftSidebarPanel`:
 *
 *   - `<1024px`: bottom sheet. Pool gets full width; a 48px chrome bar at the
 *     bottom shows a Roster summary + Queue count and toggles the sheet.
 *   - `1024–1440px`: 52px right-edge mini-rail. Hover or click opens an
 *     overlay drawer that floats over the pool without shrinking it.
 *   - `≥1440px`: pinned 320px panel by default with a Pin/Unpin toggle.
 *     When unpinned behaves like the 1024–1440 rail.
 */
export function DraftTeamSidebar(props: DraftTeamSidebarProps) {
  const isLarge = useMediaQuery('(min-width: 1440px)');
  const isMd = useMediaQuery('(min-width: 1024px)');
  const [pinned, setPinned] = useLocalStorageState<boolean>('draft.sidebarPinned', true);

  // Mode resolution
  // - mobile (no md): bottom sheet
  // - md (no large): rail + overlay
  // - large + pinned: docked
  // - large + unpinned: rail + overlay
  if (!isMd) {
    return <BottomSheetShell {...props} />;
  }
  if (isLarge && pinned) {
    return (
      <div className="w-[320px] flex-shrink-0 min-h-0 flex flex-col">
        <DraftSidebarPanel
          {...props}
          pinned
          onTogglePin={() => setPinned(false)}
        />
      </div>
    );
  }
  return (
    <RailWithOverlayShell
      {...props}
      showPinToggle={isLarge}
      pinned={pinned}
      onTogglePin={() => setPinned(true)}
    />
  );
}

// ─── 1024–1440 + unpinned-large: rail + floating overlay ──────────────────

interface RailWithOverlayShellProps extends DraftTeamSidebarProps {
  showPinToggle: boolean;
  pinned: boolean;
  onTogglePin: () => void;
}

function RailWithOverlayShell(props: RailWithOverlayShellProps) {
  const {
    teamOrder, isLiveMode, userTeamId, currentDrafterId, presence,
    selectedTeamId, showPinToggle, pinned, onTogglePin,
  } = props;
  const [open, setOpen] = useState(false);

  // Order: user's team first in live mode, mirroring the panel
  const orderedTeams = isLiveMode && userTeamId
    ? [
      teamOrder.find(p => p.id === userTeamId)!,
      ...teamOrder.filter(p => p.id !== userTeamId),
    ].filter(Boolean) as Player[]
    : teamOrder;

  // Esc closes the overlay
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <DraftSidebarRail
        teamOrder={orderedTeams}
        selectedTeamId={selectedTeamId}
        onSelectTeam={(id) => { props.onSelectTeam(id); }}
        onOpen={() => setOpen(true)}
        currentDrafterId={currentDrafterId}
        isLiveMode={isLiveMode}
        userTeamId={userTeamId}
        presence={presence}
        pinned={showPinToggle ? pinned : undefined}
        onTogglePin={showPinToggle ? onTogglePin : undefined}
      />

      {/* Floating overlay — slides in from the right on top of the pool. */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close team panel"
        className={cn(
          'fixed inset-0 z-40 bg-transparent transition-opacity duration-200',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-label="Team panel"
        aria-hidden={!open}
        className={cn(
          'fixed top-0 right-0 z-50 h-screen w-[320px] transition-transform duration-[220ms] ease-out',
          open ? 'translate-x-0' : 'translate-x-full pointer-events-none',
        )}
      >
        <DraftSidebarPanel
          {...props}
          floating
          onClose={() => setOpen(false)}
          pinned={showPinToggle ? pinned : undefined}
          onTogglePin={showPinToggle ? onTogglePin : undefined}
        />
      </aside>
    </>
  );
}

// ─── <1024px: bottom sheet ────────────────────────────────────────────────

function BottomSheetShell(props: DraftTeamSidebarProps) {
  const {
    teamOrder, teamRosters, userTeamId, draftQueue = [], isLiveMode,
  } = props;
  const [open, setOpen] = useState(false);

  const userPlayer = userTeamId ? teamOrder.find(p => p.id === userTeamId) : undefined;
  const userRoster = userPlayer ? teamRosters.get(userPlayer.id) ?? [] : [];

  // Esc closes the sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Persistent bottom chrome bar — taps to open the sheet. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close team panel' : 'Open team panel'}
        aria-expanded={open}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-30 h-12 px-3 flex items-center gap-3',
          'bg-surface-raised border-t border-border-default',
          'text-[11px] font-mono text-text-muted',
        )}
      >
        {userPlayer ? (
          <TeamLogo abbrev={userPlayer.teamAbbrev} color={userPlayer.teamColor} size="sm" logoPath={userPlayer.logoPath} />
        ) : (
          <div className="w-7 h-7 rounded-full bg-surface-overlay" aria-hidden />
        )}
        <span className="text-text-primary">Roster ({userRoster.length})</span>
        {isLiveMode && draftQueue.length > 0 && (
          <span className="text-pink">Queue ({draftQueue.length})</span>
        )}
        <span className="ml-auto inline-flex items-center text-text-muted">
          <ChevronUp
            size={14}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {/* Backdrop */}
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close team panel"
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity duration-200',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sheet itself — anchored above the chrome bar, slides up from below. */}
      <aside
        role="dialog"
        aria-label="Team panel"
        aria-hidden={!open}
        className={cn(
          'fixed bottom-12 left-0 right-0 z-40 max-h-[78vh] flex flex-col',
          'transition-transform duration-[220ms] ease-out',
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none',
        )}
      >
        <DraftSidebarPanel
          {...props}
          floating
          onClose={() => setOpen(false)}
        />
      </aside>
    </>
  );
}
