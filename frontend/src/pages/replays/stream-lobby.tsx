import { ArrowLeft, Crown, GripVertical, Play, Radio } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { TeamCoachStack } from '@/components/team-coach-stack';
import { cn } from '@/lib/utils';
import { PREROLL_DELAY_OPTIONS, type QueueEntry } from './stream-types';

interface LobbyProps {
  week: number;
  entries: QueueEntry[];
  featured: Set<string>;
  dragIndex: number | null;
  prerollDelayMs: number;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onToggleFeatured: (id: string) => void;
  onChangeDelay: (ms: number) => void;
  onStart: () => void;
  onBack: () => void;
}

/**
 * Pre-stream queue editor. The admin reorders + flags featured matches
 * before going live.
 */
export function StreamLobby({
  week,
  entries,
  featured,
  dragIndex,
  prerollDelayMs,
  onDragStart,
  onDragOver,
  onDragEnd,
  onToggleFeatured,
  onChangeDelay,
  onStart,
  onBack,
}: LobbyProps) {
  return (
    <div className="h-full flex flex-col p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back to replays
        </button>
        <div className="flex items-center gap-2 text-text-muted">
          <Radio size={14} className="text-neon" />
          <span className="font-mono text-[11px] uppercase tracking-widest">Broadcast Cockpit</span>
        </div>
      </div>

      <h1 className="font-mono font-bold uppercase tracking-[0.2em] text-3xl mb-1">
        <span className="text-neon">Week {week}</span>{' '}
        <span className="text-text-primary">Stream Queue</span>
      </h1>
      <p className="text-sm text-text-muted mb-6">
        Drag to reorder. Toggle "Featured" for headline matches.
        Hit Start when you're ready to go live.
      </p>

      <div className="flex items-center gap-4 mb-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
          Pre-roll delay
        </span>
        <div className="flex gap-1">
          {PREROLL_DELAY_OPTIONS.map(ms => (
            <button
              key={ms}
              onClick={() => onChangeDelay(ms)}
              className={cn(
                'px-2.5 py-1 rounded-md border text-[11px] font-mono transition-colors',
                prerollDelayMs === ms
                  ? 'border-neon/40 bg-neon/10 text-neon'
                  : 'border-border-default text-text-muted hover:text-text-primary',
              )}
            >
              {ms / 1000}s
            </button>
          ))}
        </div>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border-default bg-surface-raised">
        <div className="divide-y divide-border-subtle">
          {entries.map((entry, idx) => {
            const isFeatured = featured.has(entry.id);
            const isDragging = dragIndex === idx;
            return (
              <div
                key={entry.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 transition-colors cursor-move',
                  isDragging ? 'bg-neon/5 opacity-70' : 'hover:bg-surface-overlay/50',
                )}
              >
                <GripVertical size={16} className="text-text-muted/60 shrink-0" />

                <span className="font-mono text-[10px] tabular-nums text-text-muted w-6 shrink-0 text-right">
                  {idx + 1}
                </span>

                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    color: entry.league.color,
                    backgroundColor: `${entry.league.color}15`,
                  }}
                >
                  {entry.league.name.replace(' League', '')}
                </span>

                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {entry.homeTeam ? (
                    <TeamCoachStack
                      team={{
                        leagueId: entry.league.id,
                        teamId: entry.homeTeam.id,
                        teamAbbrev: entry.homeTeam.teamAbbrev,
                        teamColor: entry.homeTeam.teamColor,
                        logoPath: entry.homeTeam.logoPath,
                        owner: entry.homeTeam.owner,
                      }}
                      side="right"
                      size="sm"
                    />
                  ) : (
                    <TeamLogo abbrev="???" color="#6b7280" size="sm" />
                  )}
                  <span className="text-sm font-medium text-text-primary truncate">
                    {entry.homeTeam?.teamName ?? entry.match.homePlayer}
                  </span>

                  <span className="font-mono text-[11px] tabular-nums text-text-muted px-1 shrink-0">
                    {entry.match.homeScore ?? '-'}-{entry.match.awayScore ?? '-'}
                  </span>

                  <span className="text-sm font-medium text-text-primary truncate">
                    {entry.awayTeam?.teamName ?? entry.match.awayPlayer}
                  </span>
                  {entry.awayTeam ? (
                    <TeamCoachStack
                      team={{
                        leagueId: entry.league.id,
                        teamId: entry.awayTeam.id,
                        teamAbbrev: entry.awayTeam.teamAbbrev,
                        teamColor: entry.awayTeam.teamColor,
                        logoPath: entry.awayTeam.logoPath,
                        owner: entry.awayTeam.owner,
                      }}
                      side="left"
                      size="sm"
                    />
                  ) : (
                    <TeamLogo abbrev="???" color="#6b7280" size="sm" />
                  )}
                </div>

                <button
                  onClick={() => onToggleFeatured(entry.id)}
                  title={isFeatured ? 'Unmark featured' : 'Mark as featured'}
                  className={cn(
                    'flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-md border transition-colors',
                    isFeatured
                      ? 'border-neon/40 bg-neon/10 text-neon'
                      : 'border-border-default text-text-muted hover:text-text-primary',
                  )}
                >
                  <Crown size={11} />
                  {isFeatured ? 'Featured' : 'Feature'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between mt-6">
        <span className="font-mono text-[11px] text-text-muted">
          {entries.length} match{entries.length === 1 ? '' : 'es'} queued
          {featured.size > 0 ? ` · ${featured.size} featured` : ''}
        </span>
        <button
          onClick={onStart}
          disabled={entries.length === 0}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md font-mono text-[11px] uppercase tracking-widest transition-colors',
            entries.length === 0
              ? 'border border-border-default text-text-muted/40 cursor-not-allowed'
              : 'border border-neon/40 bg-neon/10 text-neon hover:bg-neon/20',
          )}
        >
          <Play size={14} />
          Start Stream
        </button>
      </div>
    </div>
  );
}
