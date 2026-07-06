/**
 * Arena Battle HUD — PS iframe with collapsible side panels.
 *
 * Left panel: live K/D stats (updated via WS arena_stats).
 * Right panel: opponent roster + compact type coverage (scouting cheat sheet).
 * Bottom bar: back to lobby, toggle panels, spectator count.
 *
 * Both rails auto-collapse under 1024px viewport width — there's no room
 * next to the PS iframe at that size. The manual open/close toggles still
 * work whenever the viewport is wide enough to show them.
 */
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose, ArrowLeft, Eye, Skull, Circle } from 'lucide-react';
import type { LiveMatchStats } from './use-arena-websocket';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { useMediaQuery } from '@/lib/use-media-query';

const PS_URL = import.meta.env.VITE_SHOWDOWN_URL || 'https://sim.cannoli.live';

interface BattleHudProps {
  matchId: string;
  psRoomId: string | null;
  isOfficial: boolean;
  label: string; // e.g. "Week 5: Sass Ketchums vs Power Rangers"
  liveStats: LiveMatchStats | null;
  spectatorCount?: number;
  onBackToLobby: () => void;
}

export function BattleHud(props: BattleHudProps) {
  const { psRoomId, isOfficial, label, liveStats, spectatorCount, onBackToLobby } = props;
  const [leftOpen, setLeftOpen] = useLocalStorageState<boolean>('arena-panel-left', true);
  const [rightOpen, setRightOpen] = useLocalStorageState<boolean>('arena-panel-right', true);
  const isWide = useMediaQuery('(min-width: 1024px)');
  const showLeftPanel = isWide && leftOpen;
  const showRightPanel = isWide && rightOpen;

  const iframeUrl = psRoomId ? `${PS_URL}/${psRoomId}` : PS_URL;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-raised border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
          <span className="font-mono font-bold uppercase tracking-wider text-orange-400 shrink-0">Arena</span>
          <span className="text-text-muted shrink-0">&mdash;</span>
          <span className="text-text-primary font-medium truncate min-w-0 flex-1">{label}</span>
          {isOfficial && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-400/15 text-orange-400 shrink-0">
              Official
            </span>
          )}
        </div>
      </div>

      {/* Main content: left panel + iframe + right panel */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Live Stats */}
        {showLeftPanel && (
          <div className="w-56 flex-shrink-0 border-r border-border-default bg-surface-raised overflow-y-auto">
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-text-secondary">
                  Live Stats
                </h3>
                <button
                  onClick={() => setLeftOpen(false)}
                  className="p-1.5 -m-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
                  title="Hide panel"
                  aria-label="Hide live stats panel"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <LiveStatsPanel stats={liveStats} />
            </div>
          </div>
        )}

        {/* Center: PS iframe — see PlayTab for the absolute-pin rationale.
            Without overflow:hidden + absolute inset:0, the iframe ignores
            flex shrink and the PS toolbar/canvas leaks past the right edge. */}
        <div
          className="flex-1 min-w-0 min-h-0 relative"
          style={{ overflow: 'hidden', maxWidth: '100%', maxHeight: '100%' }}
        >
          {isWide && !leftOpen && (
            <button
              onClick={() => setLeftOpen(true)}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-surface-raised border border-border-default rounded-r-md p-2 text-text-muted hover:text-text-primary transition-colors"
              title="Show live stats"
              aria-label="Show live stats panel"
            >
              <ChevronRight size={14} />
            </button>
          )}

          {/*
            sandbox tokens — all are required for the PS client to function:
              allow-scripts      — PS is a JS-heavy app (battle engine, UI)
              allow-same-origin  — needed for cookies (SSO sid), localStorage, and
                                   the cannoli-battle plugin that posts to the parent
              allow-forms        — login form inside PS client
              allow-popups       — PS opens replays and external links in new tabs
              allow-modals       — PS uses alert/confirm/prompt dialogs
              allow-popups-to-escape-sandbox — lets popups opened by PS behave as
                                   normal top-level pages (otherwise they inherit
                                   this sandbox and may break)
            Notably absent: allow-top-navigation — this is the key dangerous default
            we are removing; without it the iframe cannot navigate the parent page.
          */}
          <iframe
            src={iframeUrl}
            className="absolute inset-0 block h-full w-full border-0"
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox allow-downloads"
            title="Pokemon Showdown Battle"
          />

          {isWide && !rightOpen && (
            <button
              onClick={() => setRightOpen(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-surface-raised border border-border-default rounded-l-md p-2 text-text-muted hover:text-text-primary transition-colors"
              title="Show scouting"
              aria-label="Show scouting panel"
            >
              <ChevronLeft size={14} />
            </button>
          )}
        </div>

        {/* Right panel: Scouting */}
        {showRightPanel && (
          <div className="w-56 flex-shrink-0 border-l border-border-default bg-surface-raised overflow-y-auto">
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-text-secondary">
                  Scouting
                </h3>
                <button
                  onClick={() => setRightOpen(false)}
                  className="p-1.5 -m-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
                  title="Hide panel"
                  aria-label="Hide scouting panel"
                >
                  <PanelRightClose size={14} />
                </button>
              </div>
              <ScoutingPanel stats={liveStats} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-raised border-t border-border-default flex-shrink-0">
        <button
          onClick={onBackToLobby}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={12} />
          Back to Lobby
        </button>

        <div className="flex items-center gap-3">
          {isWide && (
            <button
              onClick={() => { setLeftOpen(v => !v); setRightOpen(v => !v); }}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Toggle Panels
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-text-muted" title="Spectators">
            <Eye size={12} />
            <span className="tabular-nums">{spectatorCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Live Stats Panel ─────────────────────────────────────────────────────

function LiveStatsPanel({ stats }: { stats: LiveMatchStats | null }) {
  if (!stats) {
    return (
      <div className="text-xs text-text-muted text-center py-4">
        Waiting for match data...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TeamStatsBlock
        label={stats.home.player}
        pokemon={stats.home.pokemon}
        teraRemaining={stats.terasRemaining.home}
      />
      <div className="h-px bg-border-subtle" />
      <TeamStatsBlock
        label={stats.away.player}
        pokemon={stats.away.pokemon}
        teraRemaining={stats.terasRemaining.away}
      />
      <div className="text-center text-[10px] text-text-muted font-mono">
        Turn {stats.turn}
      </div>
    </div>
  );
}

function TeamStatsBlock({ label, pokemon, teraRemaining }: {
  label: string;
  pokemon: LiveMatchStats['home']['pokemon'];
  teraRemaining: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-semibold text-text-primary truncate min-w-0 flex-1">{label}</span>
        {!teraRemaining && (
          <span className="text-[9px] text-text-muted shrink-0">Tera used</span>
        )}
      </div>
      <div className="space-y-0.5">
        {pokemon.map(mon => (
          <div
            key={mon.species}
            className={`flex items-center justify-between px-2 py-1 rounded text-[11px] ${
              mon.fainted ? 'opacity-40' : ''
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {mon.fainted ? (
                <Skull size={10} className="text-red-400 shrink-0" data-testid="hud-fainted-icon" />
              ) : (
                <Circle size={10} className="text-green-400 shrink-0 fill-green-400" data-testid="hud-alive-icon" />
              )}
              <span className="text-text-primary truncate min-w-0 flex-1">{mon.species}</span>
              {mon.teraUsed && mon.teraType && (
                <span className="text-[9px] text-purple-400 shrink-0">
                  T:{mon.teraType}
                </span>
              )}
            </div>
            {mon.kills > 0 && (
              <span className="text-[10px] font-mono text-neon ml-1 flex-shrink-0">
                K:{mon.kills}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scouting Panel ───────────────────────────────────────────────────────

function ScoutingPanel({ stats }: { stats: LiveMatchStats | null }) {
  if (!stats) {
    return (
      <div className="text-xs text-text-muted text-center py-4">
        Waiting for match data...
      </div>
    );
  }

  // Show both rosters in neutral perspective (useful for spectators)
  return (
    <div className="space-y-4">
      <RosterBlock label={stats.home.player} pokemon={stats.home.pokemon} />
      <div className="h-px bg-border-subtle" />
      <RosterBlock label={stats.away.player} pokemon={stats.away.pokemon} />
    </div>
  );
}

function RosterBlock({ label, pokemon }: {
  label: string;
  pokemon: LiveMatchStats['home']['pokemon'];
}) {
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-text-primary mb-1.5 truncate">{label}</h4>
      <div className="space-y-0.5">
        {pokemon.map(mon => (
          <div
            key={mon.species}
            className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]"
          >
            <span className={`text-text-primary truncate min-w-0 flex-1 ${mon.fainted ? 'line-through opacity-40' : ''}`}>
              {mon.species}
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              {mon.teraUsed && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-purple-400/10 text-purple-400">
                  {mon.teraType}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
