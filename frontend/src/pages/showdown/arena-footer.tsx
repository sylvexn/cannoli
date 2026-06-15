/**
 * ArenaFooter — collapsible footer for the Showdown page.
 *
 * Collapsed (default, ~40px): thin bar with [Match] [Scrims (n)] [Live (n)]
 * mini-buttons. Click any pill to expand to ~280px showing that section.
 * Click the active pill to collapse.
 *
 * BattleHud takeover: when `viewingBattle` is set, the footer expands to
 * ~50% of viewport height and renders <BattleHud> instead of the picked
 * section. Closing the battle returns the footer to its prior state
 * (last-selected pill + height).
 *
 * Always-mounted + CSS height transition (per project conventions —
 * we avoid base-ui Sheet-style animations for panels like this).
 *
 * Pill choice + open/closed state are persisted in localStorage so the
 * user's preference survives reloads.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useArenaWebSocket, type ArenaMatch, type LiveMatch, type ScrimLobby } from './use-arena-websocket';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { Swords, Users, Tv2, ChevronDown } from 'lucide-react';
import { OfficialMatchCard } from './footer/official-match';
import { ScrimsSection } from './footer/scrims';
import { LiveMatchesSection } from './footer/live-matches';
import { BattleHud } from './battle-hud';

type Pill = 'match' | 'scrims' | 'live';

const COLLAPSED_PX = 32;
const EXPANDED_PX = 280;
const BATTLE_VH = 50; // % of viewport height when watching a battle

interface ViewingBattle {
  matchId: string;
  psRoomId: string | null;
  isOfficial: boolean;
  label: string;
}

export function ArenaFooter() {
  const { user } = useAuth();
  const arena = useArenaWebSocket();

  // REST seed before WS populates
  const [restMatch, setRestMatch] = useState<ArenaMatch | null>(null);
  const [restLive, setRestLive] = useState<LiveMatch[]>([]);
  const [restScrims, setRestScrims] = useState<ScrimLobby[]>([]);

  useEffect(() => {
    fetch('/api/arena/state', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setRestMatch(data.myMatch);
        setRestLive(data.liveMatches);
        setRestScrims(data.scrimLobbies);
      })
      .catch(() => {});
  }, []);

  const myMatch = arena.myMatch ?? restMatch;
  const liveMatches = arena.liveMatches.length > 0 ? arena.liveMatches : restLive;
  const scrimLobbies = arena.scrimLobbies.length > 0 ? arena.scrimLobbies : restScrims;

  const [viewingBattle, setViewingBattle] = useState<ViewingBattle | null>(null);

  // Auto-enter HUD when our match goes in_progress
  useEffect(() => {
    if (myMatch?.status === 'in_progress' && myMatch.psRoomId && !viewingBattle) {
      const home = myMatch.homeTeam?.name ?? 'Home';
      const away = myMatch.awayTeam?.name ?? 'Away';
      setViewingBattle({
        matchId: myMatch.matchId,
        psRoomId: myMatch.psRoomId,
        isOfficial: true,
        label: `Week ${myMatch.week}: ${home} vs ${away}`,
      });
    }
  }, [myMatch?.status, myMatch?.psRoomId]);

  // Persisted pill + open state
  const [activePill, setActivePill] = useLocalStorageState<Pill>('arena-footer-pill', 'match');
  const [isOpen, setIsOpen] = useLocalStorageState<boolean>('arena-footer-open', false);

  function togglePill(pill: Pill) {
    if (isOpen && pill === activePill) {
      setIsOpen(false);
      return;
    }
    setActivePill(pill);
    setIsOpen(true);
  }

  // Resolve the footer's layout. The footer is ALWAYS in-flow (flex-shrink-0)
  // so it reserves its own band and chokes the iframe into the remaining space
  // — the pill bar is therefore always visible and the PS client is forced to
  // lay out within a deterministic window (no full-height iframe pushing the
  // canvas below the fold).
  // - Battle HUD takeover: ~50vh.
  // - Expanded panel: 280px.
  // - Collapsed pill bar: 32px.
  const collapsed = !viewingBattle && !isOpen;
  const containerStyle: React.CSSProperties = collapsed
    ? { height: COLLAPSED_PX }
    : viewingBattle
      ? { height: `${BATTLE_VH}vh` }
      : { height: `${EXPANDED_PX}px` };

  return (
    <div
      className="flex-shrink-0 transition-[height] duration-200 ease-out border-t border-border-default bg-surface-base flex flex-col overflow-hidden"
      style={containerStyle}
    >
      {/* Pill bar — always visible, even during battle (acts as the "back" affordance is the battle's own bottom bar) */}
      {!viewingBattle && (
        <div className="flex items-center gap-1 px-2 h-8 flex-shrink-0">
          <PillButton
            active={isOpen && activePill === 'match'}
            onClick={() => togglePill('match')}
            icon={<Swords size={12} />}
            label="Match"
            accent="orange"
            badge={myMatch?.status === 'in_progress' ? 'LIVE' : null}
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
                onClick={() => setIsOpen(false)}
                className="ml-2 text-text-muted hover:text-text-primary transition-colors"
                title="Collapse"
                aria-label="Collapse footer"
              >
                <ChevronDown size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Body — battle HUD OR section content */}
      {viewingBattle ? (
        <div className="flex-1 min-h-0">
          <BattleHud
            matchId={viewingBattle.matchId}
            psRoomId={viewingBattle.psRoomId}
            isOfficial={viewingBattle.isOfficial}
            label={viewingBattle.label}
            liveStats={arena.liveStats}
            spectatorCount={arena.spectatorCounts[viewingBattle.matchId]}
            onBackToLobby={() => setViewingBattle(null)}
          />
        </div>
      ) : isOpen ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {activePill === 'match' && (
            <OfficialMatchCard
              match={myMatch}
              user={user}
              onReady={arena.readyUp}
              onUnready={arena.unready}
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
              onSpectate={(m) => {
                const home = m.homeTeam?.name ?? 'Home';
                const away = m.awayTeam?.name ?? 'Away';
                setViewingBattle({
                  matchId: m.matchId,
                  psRoomId: m.psRoomId,
                  isOfficial: true,
                  label: `Week ${m.week}: ${home} vs ${away}`,
                });
                arena.subscribeMatch(m.matchId);
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Pill button ──────────────────────────────────────────────────────────

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
