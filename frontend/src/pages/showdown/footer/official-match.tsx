/**
 * OfficialMatchCard — the coach's league battles, with a week picker.
 *
 * A coach normally plays the current week's fixture, but battles sometimes get
 * played early or as make-ups (issue: availability / vacations). So instead of
 * locking to the current week, this lists every still-playable fixture and lets
 * the coach choose which week to battle, then ready up that specific match.
 *
 * Extracted from arena-tab.tsx so it can render standalone inside the
 * Showdown footer.
 */
import { Link } from 'react-router-dom';
import { Swords, LogIn, Loader2, Zap, AlertTriangle } from 'lucide-react';
import { fixtureLabel, fixtureShortLabel } from '@/lib/constants';
import type { ArenaMatch } from '../use-arena-websocket';

interface Props {
  matches: ArenaMatch[];
  selected: ArenaMatch | null;
  onSelect: (matchId: string) => void;
  user: any;
  onReady: (matchId: string) => void;
  onUnready: (matchId: string) => void;
  /** Whether the Showdown monitor bot is online — gates battle creation. */
  botConnected: boolean;
  /** Latest match-error string from the server (e.g. "bot is offline"). */
  matchError: string | null;
}

export function OfficialMatchCard({
  matches, selected, onSelect, user, onReady, onUnready, botConnected, matchError,
}: Props) {
  const currentWeek = matches.find(m => m.isCurrentWeek)?.week ?? null;

  return (
    <section className="rounded-lg border border-border-default bg-surface-raised p-5">
      <div className="flex items-center gap-2 mb-3">
        <Swords size={14} className="text-orange-400" />
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
          Your Matches
        </h2>
        <BotStatus connected={botConnected} />
      </div>

      {!user ? (
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <LogIn size={14} />
          Log in to see your matches.
        </div>
      ) : matches.length === 0 ? (
        <div className="text-text-muted text-sm">
          No matches to play right now.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Week picker — battle early, on time, or a make-up */}
          {matches.length > 1 && (
            <div>
              <div className="text-[11px] text-text-muted uppercase tracking-wider mb-1.5">
                Choose a week to battle
              </div>
              <div className="flex flex-wrap gap-1.5">
                {matches.map(m => (
                  <WeekPill
                    key={m.matchId}
                    match={m}
                    active={selected?.matchId === m.matchId}
                    onClick={() => onSelect(m.matchId)}
                  />
                ))}
              </div>
            </div>
          )}

          {selected && (
            <SelectedMatch
              match={selected}
              currentWeek={currentWeek}
              onReady={onReady}
              onUnready={onUnready}
              botConnected={botConnected}
              matchError={matchError}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ─── Week picker pill ────────────────────────────────────────────────────────

function WeekPill({ match, active, onClick }: { match: ArenaMatch; active: boolean; onClick: () => void }) {
  const opponent = match.isHome ? match.awayTeam : match.homeTeam;
  const dot =
    match.status === 'in_progress' ? 'bg-green-400 animate-pulse'
    : match.status === 'ready' ? 'bg-orange-400'
    : match.status === 'completed' || match.status === 'disputed' ? 'bg-text-muted/40'
    : 'bg-text-muted';

  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        active
          ? 'bg-orange-400/15 text-orange-400 ring-1 ring-orange-400/40'
          : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="font-mono">{fixtureShortLabel(match)}</span>
      {match.isCurrentWeek && (
        <span className="text-[9px] font-mono uppercase text-orange-400/80">now</span>
      )}
      <span className="text-text-muted">{opponent?.abbrev.toUpperCase() ?? 'TBD'}</span>
    </button>
  );
}

// ─── Bot status indicator ────────────────────────────────────────────────────

function BotStatus({ connected }: { connected: boolean }) {
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[11px]" title="Showdown match bot">
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-text-muted'}`} />
      <span className={connected ? 'text-green-400' : 'text-text-muted'}>
        {connected ? 'Bot online' : 'Bot offline'}
      </span>
    </span>
  );
}

// ─── Selected match detail ───────────────────────────────────────────────────

function SelectedMatch({
  match, currentWeek, onReady, onUnready, botConnected, matchError,
}: {
  match: ArenaMatch;
  currentWeek: number | null;
  onReady: (matchId: string) => void;
  onUnready: (matchId: string) => void;
  botConnected: boolean;
  matchError: string | null;
}) {
  const timing =
    match.phase === 'playoffs' || currentWeek === null || match.week === currentWeek ? null
    : match.week > currentWeek ? 'Playing ahead of schedule'
    : 'Make-up match';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <TeamDisplay team={match.homeTeam} isReady={match.readyHome} leagueId={match.leagueId} />
        <span className="text-text-muted text-xs font-mono uppercase">vs</span>
        <TeamDisplay team={match.awayTeam} isReady={match.readyAway} leagueId={match.leagueId} />
      </div>

      <div className="text-xs text-text-muted text-center">
        {fixtureLabel(match)} &middot; {match.leagueId.charAt(0).toUpperCase() + match.leagueId.slice(1)} League
        {match.status === 'in_progress' && (
          <span className="ml-2 text-green-400 font-medium">
            <Zap size={10} className="inline" /> LIVE
          </span>
        )}
        {timing && match.status !== 'in_progress' && (
          <span className="ml-2 text-amber-400/90">&middot; {timing}</span>
        )}
      </div>

      {(match.status === 'scheduled' || match.status === 'ready') && (
        <div className="flex justify-center">
          {(() => {
            const myReady = match.isHome ? match.readyHome : match.readyAway;
            const opponentReady = match.isHome ? match.readyAway : match.readyHome;
            const bothReady = match.readyHome && match.readyAway;

            // Genuinely creating the battle — the server flipped status to
            // 'ready' (bot was online and both teams readied up).
            if (bothReady && match.status === 'ready') {
              return (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
                    <Loader2 size={14} className="animate-spin" />
                    Both ready — starting match...
                  </div>
                  {matchError && (
                    <span className="text-xs text-amber-400/90 text-center max-w-xs">{matchError}</span>
                  )}
                </div>
              );
            }

            // Both ready but the server is holding the match at 'scheduled'.
            if (bothReady && match.status === 'scheduled') {
              // Bot offline — the server kept the ready flags and will resume
              // automatically on reconnect. Calm, no spinner.
              if (!botConnected) {
                return (
                  <div className="flex flex-col items-center gap-2 max-w-xs text-center">
                    <div className="flex items-center gap-2 text-amber-400/90 font-medium text-sm">
                      <AlertTriangle size={14} className="shrink-0" />
                      Both ready — Showdown bot is offline.
                    </div>
                    <span className="text-xs text-text-muted">
                      Your match will start automatically when it reconnects.
                    </span>
                    {matchError && (
                      <span className="text-xs text-amber-400/90">{matchError}</span>
                    )}
                  </div>
                );
              }
              // Rare race: bot online but match never advanced. Let the coach retry.
              return (
                <div className="flex flex-col items-center gap-2 max-w-xs text-center">
                  <span className="text-xs text-text-muted">
                    Both ready, but the match didn't start.
                  </span>
                  <button
                    onClick={() => onReady(match.matchId)}
                    className="px-5 py-2 rounded-md text-sm font-medium transition-all bg-orange-400/20 text-orange-400 border border-orange-400/30 hover:bg-orange-400/30"
                  >
                    Retry start
                  </button>
                  {matchError && (
                    <span className="text-xs text-amber-400/90">{matchError}</span>
                  )}
                </div>
              );
            }

            return (
              <div className="flex flex-col items-center gap-2 max-w-xs text-center">
                <button
                  onClick={() => (myReady ? onUnready(match.matchId) : onReady(match.matchId))}
                  className={`px-5 py-2 rounded-md text-sm font-medium transition-all ${
                    myReady
                      ? 'bg-green-400/20 text-green-400 border border-green-400/30 hover:bg-red-400/20 hover:text-red-400 hover:border-red-400/30'
                      : 'bg-orange-400/20 text-orange-400 border border-orange-400/30 hover:bg-orange-400/30'
                  }`}
                >
                  {myReady ? 'Ready ✓ (click to unready)' : 'Ready Up'}
                </button>
                {opponentReady && (
                  <span className="text-xs text-green-400 animate-pulse">
                    Opponent is ready!
                  </span>
                )}
                {!botConnected && (
                  <span className="text-xs text-text-muted">
                    You can ready up now; the match starts when the bot reconnects.
                  </span>
                )}
                {matchError && (
                  <span className="text-xs text-amber-400/90">{matchError}</span>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {match.status === 'in_progress' && (
        <div className="text-center">
          <span className="text-sm text-green-400 font-medium">Match in progress</span>
        </div>
      )}
      {(match.status === 'completed' || match.status === 'disputed') && (
        <div className="text-center">
          <span className="text-sm text-text-muted">This match is already finished.</span>
        </div>
      )}
    </div>
  );
}

function TeamDisplay({ team, isReady, leagueId }: { team: ArenaMatch['homeTeam']; isReady: boolean; leagueId: string }) {
  if (!team) return <div className="text-text-muted text-sm">TBD</div>;
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: team.color + '20', color: team.color }}
      >
        {team.abbrev.toUpperCase()}
      </div>
      <div>
        <Link
          to={`/league/${leagueId}/teams/${team.id}`}
          className="text-sm font-medium text-text-primary hover:text-neon hover:underline transition-colors"
        >
          {team.name}
        </Link>
        <div className={`text-xs ${isReady ? 'text-green-400' : 'text-text-muted'}`}>
          {isReady ? '● Ready' : '○ Not ready'}
        </div>
      </div>
    </div>
  );
}
