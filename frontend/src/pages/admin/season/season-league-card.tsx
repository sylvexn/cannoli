import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import {
  ChevronRight, ChevronDown, Play, Pause, SkipForward, Sparkles,
  Pencil, Trash2, Zap, Trophy, RotateCw,
} from 'lucide-react';
import type { ApiDraftState, ApiLeague } from '@/lib/api';
import { PHASES, phaseConfig, getNextPhase, type EditableLeague, type Phase } from './phase-config';

interface PlayoffInfo {
  hasBracket: boolean;
  matchCount: number;
}

interface Props {
  league: EditableLeague;
  state: { phase: string; currentWeek: number; totalWeeks: number };
  draftState: ApiDraftState | null | undefined;
  apiLeague: ApiLeague | undefined;
  playoffInfo: PlayoffInfo | undefined;
  onEditLeague: (league: EditableLeague) => void;
  onDeleteLeague: (id: string) => void;
  onStartDraft: (id: string) => void;
  onPauseDraft: (id: string) => void;
  onResumeDraft: (id: string) => void;
  onOpenPlayoffsDialog: (league: EditableLeague, isRegen: boolean) => void;
  onGenerateSchedule: (league: EditableLeague) => void;
  onConfirmWeekAdvance: (id: string) => void;
  onConfirmAdvance: (league: EditableLeague) => void;
  onConfirmBackward: (leagueId: string, from: Phase, to: Phase) => void;
}

const STORAGE_KEY = 'admin-season:league-expanded';

function readExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeExpanded(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage may be disabled (private mode); silently degrade.
  }
}

/** Compact summary text shown on the collapsed pill row, e.g. "W4/12" or
 *  "Pick 47/120". Tightens noise: the most relevant per-phase counter. */
function buildSummary(
  phase: Phase | string,
  state: { currentWeek: number; totalWeeks: number },
  draftState: ApiDraftState | null | undefined,
  playoffInfo: PlayoffInfo | undefined,
): string | null {
  if (phase === 'draft') {
    if (!draftState || draftState.status === 'not_started') return 'Draft not started';
    const total = draftState.snakeOrder?.length ?? 0;
    return `Pick ${draftState.currentPickIndex}/${total || '?'}`;
  }
  if (phase === 'regular') return `W${state.currentWeek}/${state.totalWeeks}`;
  if (phase === 'playoffs') {
    if (!playoffInfo) return null;
    return playoffInfo.hasBracket ? `${playoffInfo.matchCount} matches` : 'Bracket pending';
  }
  return null;
}

export function SeasonLeagueCard({
  league, state, draftState, apiLeague, playoffInfo,
  onEditLeague, onDeleteLeague,
  onStartDraft, onPauseDraft, onResumeDraft,
  onOpenPlayoffsDialog, onGenerateSchedule,
  onConfirmWeekAdvance, onConfirmAdvance, onConfirmBackward,
}: Props) {
  const phase = state.phase as Phase;
  // phaseConfig is keyed off post-predraft phases — fall back to offseason
  // styling so the card still renders for predraft leagues.
  const config = phaseConfig[phase] ?? phaseConfig.offseason;
  const nextPhase = getNextPhase(phase);
  const Icon = config.icon;
  const isRegular = phase === 'regular';
  const isDraft = phase === 'draft';
  const atWeekLimit = isRegular && state.currentWeek >= state.totalWeeks;
  const summary = buildSummary(phase, state, draftState, playoffInfo);

  // Per-league expand state, persisted to localStorage so it survives nav.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const map = readExpanded();
    if (typeof map[league.id] === 'boolean') setExpanded(map[league.id]);
  }, [league.id]);

  function handleOpenChange(next: boolean) {
    setExpanded(next);
    const map = readExpanded();
    map[league.id] = next;
    writeExpanded(map);
  }

  return (
    <Card className="overflow-hidden">
      <Collapsible open={expanded} onOpenChange={handleOpenChange}>
        {/* ─── Pill row trigger (always visible) ─────────────────── */}
        <CollapsibleTrigger
          nativeButton={false}
          render={
            <div
              role="button"
              tabIndex={0}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-overlay/40 transition-colors w-full text-left"
            />
          }
        >
          {expanded
            ? <ChevronDown size={14} className="text-text-muted shrink-0" />
            : <ChevronRight size={14} className="text-text-muted shrink-0" />
          }
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
          <span className="text-sm font-medium text-text-primary truncate">{league.name}</span>
          <Badge variant="outline" className={`${config.color} h-5 text-[10px] gap-1`}>
            <Icon size={10} />
            {config.label}
          </Badge>
          {summary && (
            <span className="text-[11px] text-text-muted font-mono tabular-nums">
              {summary}
            </span>
          )}
          {draftState?.status === 'in_progress' && phase === 'draft' && (
            <Badge variant="outline" className="text-win bg-win/10 border-win/30 h-4 text-[9px] px-1">Live</Badge>
          )}
          {draftState?.status === 'paused' && phase === 'draft' && (
            <Badge variant="outline" className="text-draw bg-draw/10 border-draw/30 h-4 text-[9px] px-1">Paused</Badge>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onEditLeague(league); }}
              className="p-1 rounded hover:bg-surface-overlay transition-colors text-text-muted hover:text-text-primary"
              aria-label="Edit league"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteLeague(league.id); }}
              className="p-1 rounded hover:bg-loss/10 transition-colors text-text-muted hover:text-loss"
              aria-label="Delete league"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </CollapsibleTrigger>

        {/* ─── Expanded body ─────────────────────────────────────── */}
        <CollapsibleContent>
          <div className="border-t border-border-subtle">
            <CardContent className="space-y-4 pt-4">
              {/* Phase timeline */}
              <div className="flex items-center gap-1">
                {PHASES.map((p, i) => {
                  const isCurrent = p === phase;
                  const isPast = PHASES.indexOf(p) < PHASES.indexOf(phase);
                  const pConfig = phaseConfig[p];
                  return (
                    <div key={p} className="flex items-center gap-1 flex-1">
                      <div className={`flex-1 h-1.5 rounded-full transition-colors ${
                        isCurrent ? pConfig.color.split(' ')[1] : isPast ? 'bg-win/30' : 'bg-surface-overlay'
                      }`} />
                      {i < PHASES.length - 1 && (
                        <ChevronRight size={10} className={`shrink-0 ${isPast || isCurrent ? 'text-text-secondary' : 'text-text-muted/30'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-1 justify-between text-[10px] text-text-muted px-0.5">
                {PHASES.map(p => (
                  <span key={p} className={`${p === phase ? 'text-text-primary font-medium' : ''}`}>
                    {phaseConfig[p].label}
                  </span>
                ))}
              </div>

              {/* Draft controls */}
              {isDraft && (
                <div className="space-y-2 rounded-md border border-draw/20 bg-draw/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <Zap size={14} className="text-draw" />
                      <span className="text-text-primary font-medium">Draft Engine</span>
                      {draftState && (
                        <Badge variant="outline" className={
                          draftState.status === 'in_progress' ? 'text-win bg-win/10 border-win/30' :
                          draftState.status === 'paused' ? 'text-draw bg-draw/10 border-draw/30' :
                          draftState.status === 'completed' ? 'text-neon bg-neon/10 border-neon/30' :
                          'text-text-muted'
                        }>
                          {draftState.status === 'in_progress' ? 'Live' :
                           draftState.status === 'paused' ? 'Paused' :
                           draftState.status === 'completed' ? 'Completed' : 'Not Started'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {(!draftState || draftState.status === 'not_started') && (
                        <Button
                          size="sm"
                          onClick={() => onStartDraft(league.id)}
                          className="bg-win text-surface-base hover:bg-win/90 h-7 text-xs"
                        >
                          <Play size={12} />
                          Start Draft
                        </Button>
                      )}
                      {draftState?.status === 'in_progress' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onPauseDraft(league.id)}
                          className="h-7 text-xs"
                        >
                          <Pause size={12} />
                          Pause
                        </Button>
                      )}
                      {draftState?.status === 'paused' && (
                        <Button
                          size="sm"
                          onClick={() => onResumeDraft(league.id)}
                          className="bg-win text-surface-base hover:bg-win/90 h-7 text-xs"
                        >
                          <Play size={12} />
                          Resume
                        </Button>
                      )}
                    </div>
                  </div>
                  {draftState && draftState.status !== 'not_started' && (
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span className="font-mono tabular-nums">
                        Pick {draftState.currentPickIndex} / {draftState.snakeOrder?.length ?? '?'}
                      </span>
                      <div className="flex-1 h-1 rounded-full bg-surface-overlay overflow-hidden">
                        <div
                          className="h-full rounded-full bg-draw transition-all"
                          style={{ width: `${draftState.snakeOrder?.length ? (draftState.currentPickIndex / draftState.snakeOrder.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Playoff bracket controls (playoffs phase only) */}
              {phase === 'playoffs' && (() => {
                const bracketSize = (apiLeague as any)?.playoffTeamCount ?? 6;
                const info = playoffInfo;
                const hasBracket = !!info?.hasBracket;
                return (
                  <div className="space-y-2 rounded-md border border-pink/20 bg-pink/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <Trophy size={14} className="text-pink" />
                        <span className="text-text-primary font-medium">Playoff Bracket</span>
                        <Badge variant="outline" className="text-pink border-pink/30">
                          Top {bracketSize}
                        </Badge>
                        {hasBracket ? (
                          <Badge variant="outline" className="text-win bg-win/10 border-win/30">
                            {info!.matchCount} matches generated
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-draw bg-draw/10 border-draw/30">
                            Not generated
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {!hasBracket ? (
                          <Button
                            size="sm"
                            onClick={() => onOpenPlayoffsDialog(league, false)}
                            className="bg-pink text-surface-base hover:bg-pink/90 h-7 text-xs"
                          >
                            <Trophy size={12} />
                            Generate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenPlayoffsDialog(league, true)}
                            className="text-loss border-loss/30 hover:bg-loss/10 h-7 text-xs"
                          >
                            <RotateCw size={12} />
                            Regenerate
                          </Button>
                        )}
                      </div>
                    </div>
                    {!hasBracket && (
                      <p className="text-[10px] text-text-muted">
                        Bracket size is set per-league in the Leagues editor (currently {bracketSize}).
                        Seeding uses the standings tiebreaker hierarchy at the time of generation.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Week progress (regular season only) */}
              {isRegular && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">Week Progress</span>
                    <span className="font-mono text-text-primary">
                      {state.currentWeek} / {state.totalWeeks}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-overlay overflow-hidden">
                    <div
                      className="h-full rounded-full bg-neon transition-all"
                      style={{ width: `${(state.currentWeek / state.totalWeeks) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onGenerateSchedule(league)}
                      className="text-draw border-draw/30 hover:bg-draw/10"
                    >
                      <Sparkles size={12} />
                      Regenerate Schedule
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onConfirmWeekAdvance(league.id)}
                      disabled={atWeekLimit}
                      className={atWeekLimit ? 'opacity-50' : ''}
                    >
                      <SkipForward size={12} />
                      Advance Week
                    </Button>
                  </div>
                </div>
              )}

              {/* Phase advance */}
              <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                <div className="text-xs text-text-muted">
                  {config.description}
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Revert affordance — undoes an accidental forward step */}
                  {(() => {
                    const idx = PHASES.indexOf(phase);
                    const prev = idx > 0 ? PHASES[idx - 1] : null;
                    if (!prev) return null;
                    return (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onConfirmBackward(league.id, phase, prev as Phase)}
                        className="text-loss/80 border-loss/20 hover:bg-loss/10 hover:text-loss h-7 text-[10px]"
                      >
                        <RotateCw size={10} className="-scale-x-100" />
                        Revert to {phaseConfig[prev as Phase].label}
                      </Button>
                    );
                  })()}
                  {nextPhase ? (
                    <Button
                      size="sm"
                      onClick={() => onConfirmAdvance(league)}
                      className="bg-neon text-surface-base hover:bg-neon/90"
                    >
                      <Play size={12} />
                      Advance to {phaseConfig[nextPhase].label}
                    </Button>
                  ) : (
                    <span className="text-xs text-text-muted">Season complete</span>
                  )}
                </div>
              </div>
            </CardContent>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
