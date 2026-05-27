import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Film } from 'lucide-react';
import { api } from '@/lib/api';
import type { ApiMatch, ApiTeam } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StreamControls } from './stream-controls';
import { StreamPreroll } from './stream-preroll';
import { StreamPostroll } from './stream-postroll';
import { StreamLowerThird } from './stream-lower-third';
import { StreamLobby } from './stream-lobby';
import {
  IDLE_FADE_MS,
  POSTROLL_MS,
  type PersistedState,
  type QueueEntry,
  type StreamPhase,
  isLocalReplay,
  storageKey,
} from './stream-types';
import { initialStreamState, streamReducer } from './stream-reducer';

/**
 * Theater-mode broadcast cockpit. The page is mounted *outside* the
 * AppShell (see App.tsx) so the iframe truly fills the viewport without
 * sidebar / header chrome. Admin-gated.
 */
export function StreamPage() {
  const { week: weekParam } = useParams<{ week: string }>();
  const navigate = useNavigate();
  const week = parseInt(weekParam ?? '0', 10);

  const { leagues, loading: leaguesLoading } = useAppData();
  const [state, dispatch] = useReducer(streamReducer, initialStreamState);
  const {
    entries,
    loading,
    streamMode,
    phase,
    activeIndex,
    featured,
    prerollDelayMs,
    prerollHeld,
    showLowerThird,
    resumePromptOpen,
    pendingState,
    endConfirmOpen,
  } = state;

  // Pure scratch UI — drag-hover index only feeds reorder dispatches,
  // doesn't interact with the rest of the machine.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Idle-fade for control bar — independent timer-driven UI.
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);

  // ── Fetch queue ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (leaguesLoading || leagues.length === 0 || !week) return;

    dispatch({ type: 'start-loading' });
    Promise.all(
      leagues.map(async (league) => {
        const [schedule, teams] = await Promise.all([
          api.getSchedule(league.id).catch(() => ({ matches: [] as ApiMatch[] })),
          api.getTeams(league.id).catch(() => [] as ApiTeam[]),
        ]);
        const matches = schedule.matches;
        const teamMap = new Map(teams.map(t => [t.id, t]));
        return matches
          .filter((m: ApiMatch) => m.week === week)
          .filter((m: ApiMatch) => m.replayUrl && m.replayUrl !== '#')
          .filter((m: ApiMatch) => m.status === 'completed' || m.homeScore !== null)
          .sort((a: ApiMatch, b: ApiMatch) => a.id.localeCompare(b.id))
          .map<QueueEntry>(m => {
            const home = teamMap.get(m.homePlayer);
            const away = teamMap.get(m.awayPlayer);
            return {
              id: m.id,
              match: m,
              league,
              homeTeam: home,
              awayTeam: away,
              homeRank: home?.rank,
              awayRank: away?.rank,
            };
          });
      }),
    ).then(results => {
      dispatch({ type: 'entries-loaded', entries: results.flat() });
    });
  }, [leagues, leaguesLoading, week]);

  // ── Restore persisted state ──────────────────────────────────────────────
  useEffect(() => {
    if (loading || entries.length === 0) return;
    const raw = localStorage.getItem(storageKey(weekParam));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedState;
      // Only prompt to resume if we have meaningful progress (not first match).
      if (parsed.index > 0 && parsed.index < entries.length) {
        dispatch({ type: 'prompt-resume', pending: parsed });
      } else {
        dispatch({ type: 'apply-persisted-order', persisted: parsed });
      }
    } catch {
      // ignore corrupt state
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, entries.length]);

  function declineResume() {
    localStorage.removeItem(storageKey(weekParam));
    dispatch({ type: 'decline-resume' });
  }

  // ── Persist on changes ───────────────────────────────────────────────────
  useEffect(() => {
    if (loading || entries.length === 0) return;
    if (streamMode !== 'live') return;
    const persisted: PersistedState = {
      order: entries.map(e => e.id),
      index: activeIndex,
      featured: [...featured],
      prerollDelayMs,
    };
    localStorage.setItem(storageKey(weekParam), JSON.stringify(persisted));
  }, [entries, activeIndex, featured, prerollDelayMs, streamMode, loading, weekParam]);

  // ── Idle-fade ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (streamMode !== 'live') return;
    function bump() {
      setControlsVisible(true);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), IDLE_FADE_MS);
    }
    bump();
    window.addEventListener('mousemove', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('mousemove', bump);
      window.removeEventListener('keydown', bump);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [streamMode]);

  const active = entries[activeIndex];

  // ── Queue drag-and-drop ──────────────────────────────────────────────────
  function handleDragStart(idx: number) {
    setDragIndex(idx);
  }
  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    dispatch({ type: 'reorder-entries', from: dragIndex, to: idx });
    setDragIndex(idx);
  }
  function handleDragEnd() {
    setDragIndex(null);
  }

  // ── Phase navigation ──────────────────────────────────────────────────────
  const goToNextMatch = useCallback(() => {
    if (activeIndex >= entries.length - 1) {
      // Stream finished
      localStorage.removeItem(storageKey(weekParam));
      navigate('/replays');
      return;
    }
    dispatch({ type: 'next-match' });
  }, [activeIndex, entries.length, navigate, weekParam]);

  const goToPrevMatch = useCallback(() => {
    if (activeIndex === 0) return;
    dispatch({ type: 'prev-match' });
  }, [activeIndex]);

  const advanceFromPreroll = useCallback(
    () => dispatch({ type: 'set-phase', phase: 'replay' }),
    [],
  );

  function endStream() {
    localStorage.removeItem(storageKey(weekParam));
    dispatch({ type: 'end-stream' });
    navigate('/replays');
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading || leaguesLoading) {
    return (
      <div className="fixed inset-0 bg-surface flex items-center justify-center text-text-muted">
        Loading week {weekParam} replays...
      </div>
    );
  }

  if (!week || entries.length === 0) {
    return (
      <div className="fixed inset-0 bg-surface flex flex-col items-center justify-center gap-4 text-text-muted">
        <Film size={42} className="text-text-muted/40" />
        <div className="text-sm">
          No replays available for week {weekParam}.
        </div>
        <button
          onClick={() => navigate('/replays')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-default text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back to replays
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-surface text-text-primary overflow-hidden">
      {streamMode === 'lobby' ? (
        <StreamLobby
          week={week}
          entries={entries}
          featured={featured}
          dragIndex={dragIndex}
          prerollDelayMs={prerollDelayMs}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onToggleFeatured={(id) => dispatch({ type: 'toggle-featured', id })}
          onChangeDelay={(delayMs) => dispatch({ type: 'set-preroll-delay', delayMs })}
          onStart={() => dispatch({ type: 'start-stream' })}
          onBack={() => navigate('/replays')}
        />
      ) : (
        <LiveView
          active={active}
          activeIndex={activeIndex}
          total={entries.length}
          phase={phase}
          prerollHeld={prerollHeld}
          prerollDelayMs={prerollDelayMs}
          featured={featured}
          showLowerThird={showLowerThird}
          controlsVisible={controlsVisible}
          onPrev={goToPrevMatch}
          onNext={goToNextMatch}
          onTogglePause={() => dispatch({ type: 'toggle-preroll-held' })}
          onToggleLowerThird={() => dispatch({ type: 'toggle-lower-third' })}
          onEnd={() => dispatch({ type: 'set-end-confirm-open', open: true })}
          onPrerollAdvance={advanceFromPreroll}
          onPrerollSkip={goToNextMatch}
          onPrerollHold={(held) => dispatch({ type: 'set-preroll-held', held })}
          onPrerollReplay={() => dispatch({ type: 'replay-preroll' })}
          onPostrollContinue={goToNextMatch}
          onReplayDone={() => dispatch({ type: 'set-phase', phase: 'postroll' })}
        />
      )}

      {/* Resume prompt */}
      <Dialog
        open={resumePromptOpen}
        onOpenChange={(open) => dispatch({ type: 'set-resume-open', open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              Resume Stream?
            </DialogTitle>
            <DialogDescription>
              Found a saved stream from this week.
              {pendingState ? ` Resume from match ${pendingState.index + 1} of ${entries.length}?` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={declineResume}
              className="px-3 py-1.5 rounded-md border border-border-default text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Start over
            </button>
            <button
              onClick={() => dispatch({ type: 'accept-resume' })}
              className="px-3 py-1.5 rounded-md border border-neon/40 bg-neon/10 text-neon text-sm hover:bg-neon/20 transition-colors"
            >
              Resume
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End confirm */}
      <Dialog
        open={endConfirmOpen}
        onOpenChange={(open) => dispatch({ type: 'set-end-confirm-open', open })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest">
              End Stream?
            </DialogTitle>
            <DialogDescription>
              This will return you to the replay gallery and clear saved progress.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => dispatch({ type: 'set-end-confirm-open', open: false })}
              className="px-3 py-1.5 rounded-md border border-border-default text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Keep streaming
            </button>
            <button
              onClick={endStream}
              className="px-3 py-1.5 rounded-md border border-loss/40 bg-loss/10 text-loss text-sm hover:bg-loss/20 transition-colors"
            >
              End stream
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Live (theater mode) ────────────────────────────────────────────────────

interface LiveProps {
  active: QueueEntry | undefined;
  activeIndex: number;
  total: number;
  phase: StreamPhase;
  prerollHeld: boolean;
  prerollDelayMs: number;
  featured: Set<string>;
  showLowerThird: boolean;
  controlsVisible: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onToggleLowerThird: () => void;
  onEnd: () => void;
  onPrerollAdvance: () => void;
  onPrerollSkip: () => void;
  onPrerollHold: (held: boolean) => void;
  onPrerollReplay: () => void;
  onPostrollContinue: () => void;
  onReplayDone: () => void;
}

function LiveView(props: LiveProps) {
  const {
    active, activeIndex, total, phase, prerollHeld, prerollDelayMs, featured,
    showLowerThird, controlsVisible,
    onPrev, onNext, onTogglePause, onToggleLowerThird, onEnd,
    onPrerollAdvance, onPrerollSkip, onPrerollHold, onPrerollReplay,
    onPostrollContinue, onReplayDone,
  } = props;

  if (!active) return null;
  const replayUrl = active.match.replayUrl ?? '';
  const local = isLocalReplay(replayUrl);
  const isFeatured = featured.has(active.id);

  return (
    <>
      {phase === 'preroll' && (
        <StreamPreroll
          key={`preroll-${active.id}`}
          league={active.league}
          week={active.match.week}
          matchIndex={activeIndex}
          total={total}
          homeTeam={active.homeTeam}
          awayTeam={active.awayTeam}
          homeRank={active.homeRank}
          awayRank={active.awayRank}
          durationMs={prerollDelayMs}
          isFeatured={isFeatured}
          onAdvance={onPrerollAdvance}
          onSkip={onPrerollSkip}
          onHold={onPrerollHold}
          onReplay={onPrerollReplay}
          held={prerollHeld}
        />
      )}

      {phase === 'replay' && (
        <ReplayFrame url={replayUrl} local={local} onDone={onReplayDone} />
      )}

      {phase === 'postroll' && (
        <StreamPostroll
          key={`postroll-${active.id}`}
          match={active.match}
          league={active.league}
          homeTeam={active.homeTeam}
          awayTeam={active.awayTeam}
          durationMs={POSTROLL_MS}
          onContinue={onPostrollContinue}
        />
      )}

      {phase === 'replay' && showLowerThird && (
        <StreamLowerThird
          league={active.league}
          week={active.match.week}
          matchIndex={activeIndex}
          total={total}
          homeTeam={active.homeTeam}
          awayTeam={active.awayTeam}
        />
      )}

      <StreamControls
        matchIndex={activeIndex}
        total={total}
        leagueLabel={active.league.name.replace(' League', '')}
        visible={controlsVisible || phase !== 'replay'}
        paused={prerollHeld}
        showLowerThird={showLowerThird}
        externalReplayUrl={replayUrl || null}
        onPrev={onPrev}
        onNext={onNext}
        onTogglePause={onTogglePause}
        onToggleLowerThird={onToggleLowerThird}
        onEnd={onEnd}
      />
    </>
  );
}

function ReplayFrame({ url, local, onDone }: { url: string; local: boolean; onDone: () => void }) {
  if (!local) {
    return (
      <div className="fixed inset-0 z-30 bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-text-muted">
          <Film size={36} className="text-text-muted/40" />
          <div className="text-sm">This replay isn't iframable from here.</div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neon/40 bg-neon/10 text-neon text-sm hover:bg-neon/20 transition-colors"
          >
            <ExternalLink size={14} />
            Open in Showdown
          </a>
          <button
            onClick={onDone}
            className="text-[11px] font-mono uppercase tracking-widest text-text-muted hover:text-text-primary transition-colors"
          >
            Skip to post-roll
          </button>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title="Replay"
      className="fixed inset-0 w-screen h-screen z-20 bg-white border-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
