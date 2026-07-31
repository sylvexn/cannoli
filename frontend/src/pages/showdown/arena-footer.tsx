/**
 * ArenaFooter — collapsible footer for the Showdown page.
 *
 * Collapsed (default, ~32px): thin bar with [Match] [Scrims (n)] [Live (n)]
 * mini-buttons. Click any pill to expand to ~280px showing that section.
 * Click the active pill to collapse.
 *
 * The footer is intentionally NEVER a second Pokemon Showdown client. The
 * page's main PS iframe (index.tsx) is the one and only PS client — a coach
 * plays their live match, and spectates others, in THAT client (or a new tab
 * for someone else's room). We used to balloon the footer into an in-page
 * "Battle HUD" that mounted a SECOND PS iframe; two PS clients share the same
 * origin's sid/localStorage and corrupt each other, so that HUD is gone.
 *
 * When the coach's own official match goes live we collapse the footer to the
 * pill bar (they're now playing in the main client — nothing to expand for).
 *
 * Always-mounted + CSS height transition (per project conventions —
 * we avoid base-ui Sheet-style animations for panels like this).
 *
 * Pill choice + open/closed state are persisted in localStorage so the
 * user's preference survives reloads.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useArenaWebSocket } from './use-arena-websocket';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { Swords, Users, Tv2, ChevronDown } from 'lucide-react';
import { OfficialMatchCard } from './footer/official-match';
import { ScrimsSection } from './footer/scrims';
import { LiveMatchesSection } from './footer/live-matches';

type Pill = 'match' | 'scrims' | 'live';

const COLLAPSED_PX = 32;
const EXPANDED_PX = 280;

// The one and only PS client lives in the page's main iframe; spectating
// someone else's room opens it here in a new tab rather than a second in-page
// client. Same base URL as the main iframe (see index.tsx).
const PS_URL = import.meta.env.VITE_SHOWDOWN_URL || 'https://sim.cannoli.live';

export function ArenaFooter({ forceOpenArena = false }: { forceOpenArena?: boolean }) {
  const { user } = useAuth();
  const arena = useArenaWebSocket();

  const { myMatches, liveMatches, scrimLobbies } = arena;

  // Which week the coach has picked to battle. Defaults to the current-week
  // fixture, falling back to the earliest still-playable one.
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const playable = myMatches.filter(m => m.status !== 'completed' && m.status !== 'disputed');
  const defaultMatch =
    playable.find(m => m.isCurrentWeek) ?? playable[0] ?? myMatches[0] ?? null;
  const selectedMatch =
    myMatches.find(m => m.matchId === selectedMatchId) ?? defaultMatch;

  const liveMine = myMatches.find(m => m.status === 'in_progress' && m.psRoomId);

  // Persisted pill + open state
  const [activePill, setActivePill] = useLocalStorageState<Pill>('arena-footer-pill', 'match');
  const [isOpen, setIsOpen] = useLocalStorageState<boolean>('arena-footer-open', false);

  // A coach has something to play this week (their current-week fixture that
  // hasn't STARTED yet). Drives the auto-open on a fresh visit so they can ready
  // up. Deliberately excludes `in_progress` — once the match is live the coach
  // is playing in the main PS client, and the collapse-on-live effect below
  // pulls the footer down to the pill bar instead of popping a panel open.
  const hasActionableCurrentMatch = myMatches.some(
    m => m.isCurrentWeek && (m.status === 'scheduled' || m.status === 'ready'),
  );

  // Track an explicit manual collapse so we never re-open the footer the coach
  // just closed. We also only auto-open ONCE per mount.
  const userCollapsedRef = useRef(false);
  const autoOpenedRef = useRef(false);
  // Remember the last live match we collapsed for, so we collapse once per
  // match-start rather than fighting the coach every render.
  const collapsedForLiveRef = useRef<string | null>(null);

  function togglePill(pill: Pill) {
    if (isOpen && pill === activePill) {
      userCollapsedRef.current = true;
      setIsOpen(false);
      return;
    }
    setActivePill(pill);
    setIsOpen(true);
  }

  function collapse() {
    userCollapsedRef.current = true;
    setIsOpen(false);
  }

  // Auto-open the Match panel on mount when:
  //   (a) ?tab=arena routed us here (overrides the persisted collapsed state), or
  //   (b) there's a playable current-week match and the coach hasn't manually
  //       collapsed the footer this session.
  // Runs at most once per mount and never fights a deliberate close.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (userCollapsedRef.current) return;

    if (forceOpenArena) {
      autoOpenedRef.current = true;
      setActivePill('match');
      setIsOpen(true);
      return;
    }

    if (hasActionableCurrentMatch && !isOpen) {
      autoOpenedRef.current = true;
      setActivePill('match');
      setIsOpen(true);
    }
  // myMatches seeds in async (REST), so re-run as it resolves; the refs keep
  // this idempotent and respectful of a manual collapse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpenArena, hasActionableCurrentMatch]);

  // When the coach's own official match goes live, collapse the footer to the
  // pill bar — they're now playing in the main PS client and there's nothing to
  // expand for. Fires once per match-start (keyed on matchId) so a coach who
  // deliberately re-opens a pill mid-battle isn't yanked closed every render.
  useEffect(() => {
    if (!liveMine) return;
    if (collapsedForLiveRef.current === liveMine.matchId) return;
    collapsedForLiveRef.current = liveMine.matchId;
    userCollapsedRef.current = true; // keep auto-open from re-popping it
    setIsOpen(false);
  // Key on the match id (fire once per match-start), not the liveMine object —
  // it's a fresh find() every render. The ref guard keeps this idempotent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMine?.matchId, setIsOpen]);

  // Count of matches the coach can still act on (not finished). Surfaced on the
  // collapsed Match pill so the 32px bar signals "you have N matches".
  const playableCount = playable.length;

  // Resolve the footer's layout. The footer is ALWAYS in-flow (flex-shrink-0)
  // so it reserves its own band and chokes the iframe into the remaining space
  // — the pill bar is therefore always visible and the PS client is forced to
  // lay out within a deterministic window (no full-height iframe pushing the
  // canvas below the fold).
  // - Expanded panel: 280px.
  // - Collapsed pill bar: 32px.
  const containerStyle: React.CSSProperties = isOpen
    ? { height: `${EXPANDED_PX}px` }
    : { height: COLLAPSED_PX };

  return (
    <div
      className="flex-shrink-0 transition-[height] duration-200 ease-out border-t border-border-default bg-surface-base flex flex-col overflow-hidden"
      style={containerStyle}
    >
      {/* Pill bar — always visible. */}
      <div className="flex items-center gap-1 px-2 h-8 flex-shrink-0">
        <PillButton
          active={isOpen && activePill === 'match'}
          onClick={() => togglePill('match')}
          icon={<Swords size={12} />}
          label="Match"
          accent="orange"
          badge={liveMine ? 'LIVE' : playableCount > 0 ? String(playableCount) : null}
        />
        <PillButton
          active={isOpen && activePill === 'scrims'}
          onClick={() => togglePill('scrims')}
          icon={<Users size={12} />}
          label="Scrims"
          accent="blue"
          badge={scrimLobbies.length > 0 ? String(scrimLobbies.length) : null}
        />
        <PillButton
          active={isOpen && activePill === 'live'}
          onClick={() => togglePill('live')}
          icon={<Tv2 size={12} />}
          label="Live"
          accent="green"
          badge={liveMatches.length > 0 ? String(liveMatches.length) : null}
        />

        <div className="ml-auto flex items-center gap-2 text-[11px] text-text-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${arena.connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span>{arena.connected ? 'Connected' : 'Reconnecting...'}</span>
          {isOpen && (
            <button
              onClick={collapse}
              className="ml-2 text-text-muted hover:text-text-primary transition-colors"
              title="Collapse"
              aria-label="Collapse footer"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body — selected section content (never a second PS client). */}
      {isOpen ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {activePill === 'match' && (
            <OfficialMatchCard
              matches={myMatches}
              selected={selectedMatch}
              onSelect={setSelectedMatchId}
              user={user}
              onReady={arena.readyUp}
              onUnready={arena.unready}
              botConnected={arena.botConnected}
              matchError={arena.lastMatchError}
            />
          )}
          {activePill === 'scrims' && (
            <ScrimsSection
              lobbies={scrimLobbies}
              user={user}
              username={user?.username}
              onCreateScrim={arena.createScrim}
              onJoinScrim={arena.joinScrim}
              onLeaveScrim={arena.leaveScrim}
              onReadyScrim={arena.readyScrim}
            />
          )}
          {activePill === 'live' && (
            <LiveMatchesSection
              matches={liveMatches}
              onWatch={(m) => {
                // Watch in the PS client (a new tab), never a second in-page
                // client. Without a psRoomId there's no room to open yet.
                if (!m.psRoomId) return;
                window.open(`${PS_URL}/${m.psRoomId}`, '_blank', 'noopener,noreferrer');
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// Pill button

type Accent = 'orange' | 'blue' | 'green';

const ACCENT_CLASSES: Record<Accent, { active: string; idle: string; badge: string }> = {
  orange: {
    active: 'bg-orange-400/15 text-orange-400 ring-1 ring-orange-400/40',
    idle: 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
    badge: 'bg-orange-400/20 text-orange-400',
  },
  blue: {
    active: 'bg-blue-400/15 text-blue-400 ring-1 ring-blue-400/40',
    idle: 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
    badge: 'bg-blue-400/20 text-blue-400',
  },
  green: {
    active: 'bg-green-400/15 text-green-400 ring-1 ring-green-400/40',
    idle: 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary',
    badge: 'bg-green-400/20 text-green-400',
  },
};

function PillButton({
  active, onClick, icon, label, accent, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: Accent;
  badge: string | null;
}) {
  const classes = ACCENT_CLASSES[accent];
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
        active ? classes.active : classes.idle
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono leading-none ${classes.badge}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
