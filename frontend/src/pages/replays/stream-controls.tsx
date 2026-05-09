import { ChevronLeft, ChevronRight, Pause, Play, Subtitles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreamControlsProps {
  matchIndex: number;
  total: number;
  leagueLabel: string;
  visible: boolean;
  paused: boolean;
  showLowerThird: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onToggleLowerThird: () => void;
  onEnd: () => void;
}

/**
 * Bottom-center floating control bar in theater mode. Auto-fades when
 * `visible` is false (parent debounces on mouse-idle).
 */
export function StreamControls({
  matchIndex,
  total,
  leagueLabel,
  visible,
  paused,
  showLowerThird,
  onPrev,
  onNext,
  onTogglePause,
  onToggleLowerThird,
  onEnd,
}: StreamControlsProps) {
  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none',
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl">
        <ControlButton onClick={onPrev} title="Previous match" disabled={matchIndex === 0}>
          <ChevronLeft size={16} />
        </ControlButton>

        <ControlButton onClick={onTogglePause} title={paused ? 'Resume interstitial' : 'Pause interstitial'}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </ControlButton>

        <ControlButton onClick={onNext} title="Next match" disabled={matchIndex >= total - 1}>
          <ChevronRight size={16} />
        </ControlButton>

        <span className="font-mono text-[11px] uppercase tracking-widest text-text-secondary px-3 select-none">
          Match {matchIndex + 1} / {total}
          <span className="text-text-muted ml-2">— {leagueLabel}</span>
        </span>

        <ControlButton
          onClick={onToggleLowerThird}
          title={showLowerThird ? 'Hide lower-third' : 'Show lower-third'}
          active={showLowerThird}
        >
          <Subtitles size={16} />
        </ControlButton>

        <ControlButton onClick={onEnd} title="End stream" tone="danger">
          <X size={16} />
        </ControlButton>
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  title,
  children,
  disabled,
  active,
  tone,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
  tone?: 'danger';
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        'p-2 rounded-md transition-colors',
        disabled
          ? 'text-text-muted/40 cursor-not-allowed'
          : active
          ? 'text-neon bg-neon/10'
          : tone === 'danger'
          ? 'text-text-muted hover:text-loss hover:bg-loss/10'
          : 'text-text-muted hover:text-neon hover:bg-white/5',
      )}
    >
      {children}
    </button>
  );
}
