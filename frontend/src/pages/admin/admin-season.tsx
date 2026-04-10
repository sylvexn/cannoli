import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiDraftState } from '@/lib/api';
import { toast } from 'sonner';
import {
  ChevronRight, Play, Pause, SkipForward, AlertTriangle,
  Sparkles, Plus, Pencil, Trash2, Zap, Calendar, Trophy, RotateCw,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PHASES, phaseConfig, getNextPhase, PRESET_COLORS, type EditableLeague, type Phase } from './season/phase-config';
import { LeagueEditDialog } from './season/league-edit-dialog';
import { NewSeasonWizard } from './season/new-season-wizard';
import { DraftOrderEditor } from './season/draft-order-editor';

export function AdminSeason() {
  const { leagues: defaultLeagues, refreshLeagues } = useAppData();

  const [leagueList, setLeagueList] = useState<EditableLeague[]>(
    defaultLeagues.map(l => ({ id: l.id, name: l.name, color: l.color }))
  );

  const [leagueStates, setLeagueStates] = useState(
    Object.fromEntries(defaultLeagues.map(l => [l.id, { ...l.season }]))
  );

  // Draft state per league
  const [draftStates, setDraftStates] = useState<Record<string, ApiDraftState | null>>({});

  // Fetch draft states for leagues in draft phase
  const fetchDraftStates = useCallback(async () => {
    const states: Record<string, ApiDraftState | null> = {};
    for (const league of defaultLeagues) {
      if (league.season?.phase === 'draft') {
        try {
          const s = await api.getDraftState(league.id);
          states[league.id] = s;
        } catch { states[league.id] = null; }
      }
    }
    setDraftStates(states);
  }, [defaultLeagues]);

  useEffect(() => { fetchDraftStates(); }, [fetchDraftStates]);

  // Sync when defaultLeagues changes
  useEffect(() => {
    setLeagueList(defaultLeagues.map(l => ({ id: l.id, name: l.name, color: l.color })));
    setLeagueStates(Object.fromEntries(defaultLeagues.map(l => [l.id, { ...l.season }])));
  }, [defaultLeagues]);

  // Advance phase confirmation
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);

  // Week advance confirmation
  const [weekOpen, setWeekOpen] = useState(false);
  const [weekTarget, setWeekTarget] = useState<string | null>(null);

  // New season wizard
  const [wizardOpen, setWizardOpen] = useState(false);

  // League edit dialog
  const [leagueEditOpen, setLeagueEditOpen] = useState(false);
  const [editingLeague, setEditingLeague] = useState<EditableLeague | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  // Delete league confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Regenerate schedule confirmation (in-season nuclear option)
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTarget, setRegenTarget] = useState<{ id: string; name: string; phase: Phase } | null>(null);
  const [regenConfirmText, setRegenConfirmText] = useState('');
  const [regenSubmitting, setRegenSubmitting] = useState(false);

  // Playoff bracket state — { leagueId: { hasBracket, seedings? } }
  const [playoffInfo, setPlayoffInfo] = useState<Record<string, { hasBracket: boolean; matchCount: number }>>({});
  const [playoffOpen, setPlayoffOpen] = useState(false);
  const [playoffTarget, setPlayoffTarget] = useState<{ id: string; name: string; topN: number; isRegen: boolean } | null>(null);
  const [playoffPreview, setPlayoffPreview] = useState<{ teamId: string; rank: number }[]>([]);
  const [playoffConfirmText, setPlayoffConfirmText] = useState('');
  const [playoffSubmitting, setPlayoffSubmitting] = useState(false);

  // Backward phase override
  const [backwardOpen, setBackwardOpen] = useState(false);
  const [backwardTarget, setBackwardTarget] = useState<{ leagueId: string; from: Phase; to: Phase } | null>(null);
  const [backwardConfirmText, setBackwardConfirmText] = useState('');

  // Detect existing bracket per league (look at schedule playoff matches).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info: Record<string, { hasBracket: boolean; matchCount: number }> = {};
      for (const l of defaultLeagues) {
        if (l.season?.phase !== 'playoffs') continue;
        try {
          const sched = await api.getSchedule(l.id);
          const playoffMatches = sched.filter(m => m.phase === 'playoffs');
          info[l.id] = { hasBracket: playoffMatches.length > 0, matchCount: playoffMatches.length };
        } catch { /* ignore */ }
      }
      if (!cancelled) setPlayoffInfo(info);
    })();
    return () => { cancelled = true; };
  }, [defaultLeagues]);

  async function handleGenerateSchedule(league: EditableLeague) {
    const state = leagueStates[league.id];
    const phase = state?.phase as Phase | undefined;
    if (phase === 'regular' || phase === 'playoffs') {
      setRegenTarget({ id: league.id, name: league.name, phase });
      setRegenConfirmText('');
      setRegenOpen(true);
      return;
    }
    try {
      const result = await api.generateSchedule(league.id);
      toast.success(`Generated ${result.matchCount} matches`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function executeForcedRegen() {
    if (!regenTarget) return;
    if (regenConfirmText.trim() !== regenTarget.name) {
      toast.error(`Type the league name exactly to confirm: "${regenTarget.name}"`);
      return;
    }
    setRegenSubmitting(true);
    try {
      await api.generateSchedule(regenTarget.id, { force: true, confirmName: regenConfirmText.trim() });
      toast.success(`Schedule regenerated for ${regenTarget.name}`);
      refreshLeagues?.();
      setRegenOpen(false);
      setRegenTarget(null);
      setRegenConfirmText('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRegenSubmitting(false);
    }
  }

  function confirmAdvance(league: EditableLeague) {
    const state = leagueStates[league.id];
    const next = getNextPhase(state.phase as Phase);
    if (!next) return;
    setAdvanceTarget({ leagueId: league.id, from: state.phase as Phase, to: next });
    setAdvanceOpen(true);
  }

  // Backward (revert) phase. Used to undo an accidental advance — e.g.
  // playoffs → regular if the bracket was generated before someone realized
  // a forfeit needed re-entering. Backend rejects without { override, confirm }.
  function confirmBackward(leagueId: string, from: Phase, to: Phase) {
    setBackwardTarget({ leagueId, from, to });
    setBackwardConfirmText('');
    setBackwardOpen(true);
  }

  async function executeBackward() {
    if (!backwardTarget) return;
    if (backwardConfirmText.trim() !== 'I understand') {
      toast.error('Type "I understand" exactly to confirm');
      return;
    }
    try {
      await api.advancePhase(backwardTarget.leagueId, backwardTarget.to, {
        override: true,
        confirm: 'I understand',
      });
      toast.success(`Reverted to ${backwardTarget.to}`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setBackwardOpen(false);
    setBackwardTarget(null);
    setBackwardConfirmText('');
  }

  // Playoff bracket generation
  function openPlayoffsDialog(league: EditableLeague, isRegen: boolean) {
    const playoffN = (defaultLeagues.find(l => l.id === league.id) as any)?.playoffTeamCount ?? 6;
    setPlayoffTarget({ id: league.id, name: league.name, topN: playoffN, isRegen });
    setPlayoffPreview([]);
    setPlayoffConfirmText('');
    // Pre-fetch standings → seeding preview
    api.getTeams(league.id)
      .then(teams => {
        const seeded = [...teams]
          .sort((a, b) => {
            // teams from /api/leagues/:id/teams come pre-sorted by computeStandings,
            // but enforce by record + differential as fallback
            if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
            return (b.record.differential ?? 0) - (a.record.differential ?? 0);
          })
          .slice(0, playoffN);
        setPlayoffPreview(seeded.map((t, i) => ({ teamId: t.id, rank: i + 1 })));
      })
      .catch(() => setPlayoffPreview([]));
    setPlayoffOpen(true);
  }

  async function executePlayoffs() {
    if (!playoffTarget) return;
    if (playoffTarget.isRegen && playoffConfirmText.trim() !== playoffTarget.name) {
      toast.error(`Type the league name exactly to confirm: "${playoffTarget.name}"`);
      return;
    }
    setPlayoffSubmitting(true);
    try {
      const result = await api.generatePlayoffs(playoffTarget.id, { topN: playoffTarget.topN });
      toast.success(`Generated ${result.matchCount} bracket matches for ${playoffTarget.name}`);
      // Refresh local state so the button flips to "Regenerate"
      setPlayoffInfo(prev => ({
        ...prev,
        [playoffTarget.id]: { hasBracket: true, matchCount: result.matchCount },
      }));
      refreshLeagues?.();
      setPlayoffOpen(false);
      setPlayoffTarget(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPlayoffSubmitting(false);
    }
  }

  async function executeAdvance() {
    if (!advanceTarget) return;
    const { leagueId, from, to } = advanceTarget;
    try {
      await api.advancePhase(leagueId, to);
      const name = leagueList.find(l => l.id === leagueId)?.name;
      toast.success(`${name} advanced to ${phaseConfig[to].label}`);

      // Auto-generate schedule when transitioning from draft to regular
      if (from === 'draft' && to === 'regular') {
        try {
          const result = await api.generateSchedule(leagueId);
          toast.success(`Generated ${result.matchCount} matches for ${name}`);
        } catch (schedErr: any) {
          toast.error(`Phase advanced but schedule generation failed: ${schedErr.message}`);
        }
      }

      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setAdvanceOpen(false);
    setAdvanceTarget(null);
  }

  function confirmWeekAdvance(leagueId: string) {
    setWeekTarget(leagueId);
    setWeekOpen(true);
  }

  async function executeWeekAdvance() {
    if (!weekTarget) return;
    try {
      const result = await api.advanceWeek(weekTarget);
      const name = leagueList.find(l => l.id === weekTarget)?.name;
      toast.success(`${name} advanced to Week ${result.week}`);
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setWeekOpen(false);
    setWeekTarget(null);
  }

  // Draft controls
  async function handleStartDraft(leagueId: string) {
    try {
      const state = await api.startDraft(leagueId, 120);
      setDraftStates(prev => ({ ...prev, [leagueId]: state }));
      toast.success('Draft started!');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handlePauseDraft(leagueId: string) {
    try {
      await api.pauseDraft(leagueId);
      setDraftStates(prev => ({
        ...prev,
        [leagueId]: prev[leagueId] ? { ...prev[leagueId]!, status: 'paused' } : null,
      }));
      toast.success('Draft paused');
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleResumeDraft(leagueId: string) {
    try {
      const state = await api.resumeDraft(leagueId);
      setDraftStates(prev => ({ ...prev, [leagueId]: state }));
      toast.success('Draft resumed');
    } catch (err: any) { toast.error(err.message); }
  }

  // League CRUD
  function openNewLeague() {
    setEditingLeague(null);
    setEditName('');
    setEditColor(PRESET_COLORS.find(c => !leagueList.some(l => l.color === c)) ?? PRESET_COLORS[0]);
    setLeagueEditOpen(true);
  }

  function openEditLeague(league: EditableLeague) {
    setEditingLeague(league);
    setEditName(league.name);
    setEditColor(league.color);
    setLeagueEditOpen(true);
  }

  async function saveLeague() {
    const name = editName.trim();
    if (!name) return;

    try {
      if (editingLeague) {
        await api.updateLeague(editingLeague.id, { name, color: editColor });
        toast.success(`Updated "${name}"`);
      } else {
        await api.createLeague(name, editColor);
        toast.success(`Created "${name}"`);
      }
      refreshLeagues?.();
    } catch (err: any) {
      toast.error(err.message);
    }
    setLeagueEditOpen(false);
  }

  function confirmDeleteLeague(id: string) {
    setDeleteTarget(id);
    setDeleteConfirmText('');
    setDeleteOpen(true);
  }

  async function executeDeleteLeague() {
    if (!deleteTarget) return;
    const target = leagueList.find(l => l.id === deleteTarget);
    if (!target) return;
    const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
    const isLive = phase === 'regular' || phase === 'playoffs';

    if (isLive && deleteConfirmText.trim() !== target.name) {
      toast.error(`Type the league name "${target.name}" to confirm deletion`);
      return;
    }

    setDeleteSubmitting(true);
    try {
      await api.deleteLeague(deleteTarget, isLive ? { force: true, confirmName: target.name } : undefined);
      toast.success(`Deleted "${target.name}"`);
      refreshLeagues?.();
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeleteConfirmText('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Current Season:</span>
          <span className="text-text-primary font-medium font-mono">
            {defaultLeagues[0]?.season?.seasonNumber ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Leagues:</span>
          <span className="text-text-primary font-medium font-mono">{leagueList.length}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={openNewLeague}>
            <Plus size={14} />
            Add League
          </Button>
          <Button size="sm" onClick={() => setWizardOpen(true)} className="bg-pink text-surface-base hover:bg-pink/90">
            <Sparkles size={14} />
            New Season
          </Button>
        </div>
      </div>

      {/* League phase cards */}
      <div className="space-y-3">
        {leagueList.map(league => {
          const state = leagueStates[league.id];
          if (!state) return null;
          const phase = state.phase as Phase;
          const config = phaseConfig[phase];
          const nextPhase = getNextPhase(phase);
          const Icon = config.icon;
          const isRegular = phase === 'regular';
          const isDraft = phase === 'draft';
          const atWeekLimit = isRegular && state.currentWeek >= state.totalWeeks;
          const draftState = draftStates[league.id];

          return (
            <Card key={league.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                  <CardTitle className="text-base flex-1">{league.name}</CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={config.color}>
                      <Icon size={12} />
                      {config.label}
                    </Badge>
                    <button
                      onClick={() => openEditLeague(league)}
                      className="p-1 rounded hover:bg-surface-overlay transition-colors text-text-muted hover:text-text-primary"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => confirmDeleteLeague(league.id)}
                      className="p-1 rounded hover:bg-loss/10 transition-colors text-text-muted hover:text-loss"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
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
                            onClick={() => handleStartDraft(league.id)}
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
                            onClick={() => handlePauseDraft(league.id)}
                            className="h-7 text-xs"
                          >
                            <Pause size={12} />
                            Pause
                          </Button>
                        )}
                        {draftState?.status === 'paused' && (
                          <Button
                            size="sm"
                            onClick={() => handleResumeDraft(league.id)}
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
                  const apiLeague = defaultLeagues.find(l => l.id === league.id);
                  const bracketSize = (apiLeague as any)?.playoffTeamCount ?? 6;
                  const info = playoffInfo[league.id];
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
                              {info.matchCount} matches generated
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
                              onClick={() => openPlayoffsDialog(league, false)}
                              className="bg-pink text-surface-base hover:bg-pink/90 h-7 text-xs"
                            >
                              <Trophy size={12} />
                              Generate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPlayoffsDialog(league, true)}
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
                        onClick={() => handleGenerateSchedule(league)}
                        className="text-draw border-draw/30 hover:bg-draw/10"
                      >
                        <Sparkles size={12} />
                        Regenerate Schedule
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => confirmWeekAdvance(league.id)}
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
                          onClick={() => confirmBackward(league.id, phase, prev as Phase)}
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
                        onClick={() => confirmAdvance(league)}
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
            </Card>
          );
        })}
      </div>

      {/* Draft Order */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider">
          Draft Order
        </h3>
        {leagueList.map(league => (
          <DraftOrderEditor
            key={league.id}
            leagueId={league.id}
            leagueName={league.name}
            leagueColor={league.color}
          />
        ))}
      </div>

      {/* Schedule Dates */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
          <Calendar size={12} />
          Schedule Dates
        </h3>
        {leagueList.map(league => {
          const state = leagueStates[league.id];
          if (!state || !state.totalWeeks) return null;
          const existingDates: Record<string, string> = state.weekDates ?? {};
          const draftDate = defaultLeagues.find(l => l.id === league.id)?.draftDate ?? '';

          return (
            <Card key={league.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                  <span className="text-sm font-medium text-text-primary">{league.name}</span>
                </div>

                {/* Draft date */}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-text-muted w-20 shrink-0">Draft Date</label>
                  <input
                    type="datetime-local"
                    defaultValue={draftDate?.replace('Z', '').slice(0, 16) ?? ''}
                    onBlur={async (e) => {
                      const val = e.target.value;
                      try {
                        await api.updateLeague(league.id, { draftDate: val ? new Date(val).toISOString() : null });
                        toast.success('Draft date saved');
                        refreshLeagues?.();
                      } catch (err: any) { toast.error(err.message); }
                    }}
                    className="flex-1 h-7 px-2 rounded border border-border-default bg-surface-overlay text-text-primary text-xs font-mono"
                  />
                </div>

                {/* Week dates */}
                <div className="space-y-1">
                  <label className="text-xs text-text-muted">Week Dates</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {Array.from({ length: state.totalWeeks }, (_, i) => i + 1).map(week => (
                      <div key={week} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-text-muted font-mono w-5 text-right shrink-0">W{week}</span>
                        <input
                          type="date"
                          defaultValue={existingDates[String(week)] ?? ''}
                          onBlur={async (e) => {
                            const newDates = { ...existingDates };
                            if (e.target.value) {
                              newDates[String(week)] = e.target.value;
                            } else {
                              delete newDates[String(week)];
                            }
                            try {
                              await api.updateLeague(league.id, { weekDates: newDates });
                              toast.success(`Week ${week} date saved`);
                              refreshLeagues?.();
                            } catch (err: any) { toast.error(err.message); }
                          }}
                          className="flex-1 h-6 px-1.5 rounded border border-border-default bg-surface-overlay text-text-primary text-[10px] font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Advance Phase Confirmation */}
      <Dialog open={advanceOpen} onOpenChange={setAdvanceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-draw" />
              Advance Phase
            </DialogTitle>
            <DialogDescription>
              {advanceTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === advanceTarget.leagueId)?.name}</strong> from{' '}
                  <strong>{phaseConfig[advanceTarget.from].label}</strong> to{' '}
                  <strong>{phaseConfig[advanceTarget.to].label}</strong>?
                  {advanceTarget.from === 'draft' && advanceTarget.to === 'regular' && (
                    <> A round-robin schedule will be generated automatically.</>
                  )}
                  {' '}This action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>Cancel</Button>
            <Button onClick={executeAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Confirm Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Week Advance Confirmation */}
      <Dialog open={weekOpen} onOpenChange={setWeekOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Advance Week</DialogTitle>
            <DialogDescription>
              {weekTarget && (
                <>
                  Advance <strong>{leagueList.find(l => l.id === weekTarget)?.name}</strong> to{' '}
                  <strong>Week {leagueStates[weekTarget].currentWeek + 1}</strong>?
                  Ensure all match results for the current week are reported.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWeekOpen(false)}>Cancel</Button>
            <Button onClick={executeWeekAdvance} className="bg-neon text-surface-base hover:bg-neon/90">
              Advance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* League Edit Dialog */}
      <LeagueEditDialog
        open={leagueEditOpen}
        onOpenChange={setLeagueEditOpen}
        editingLeague={editingLeague}
        editName={editName}
        setEditName={setEditName}
        editColor={editColor}
        setEditColor={setEditColor}
        onSave={saveLeague}
      />

      {/* Delete League Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={(o) => { if (!o) { setDeleteOpen(false); setDeleteConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Delete League
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && (() => {
                const target = leagueList.find(l => l.id === deleteTarget);
                const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
                const isLive = phase === 'regular' || phase === 'playoffs';
                return (
                  <>
                    Permanently delete <strong>{target?.name}</strong>?
                    This removes all associated season data and cannot be undone.
                    {isLive && (
                      <span className="block mt-2 text-loss text-[11px]">
                        WARNING: This league is in <strong>{phase}</strong> phase — live trades, match results, and standings will all be wiped.
                      </span>
                    )}
                  </>
                );
              })()}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (() => {
            const target = leagueList.find(l => l.id === deleteTarget);
            const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
            const isLive = phase === 'regular' || phase === 'playoffs';
            if (!isLive || !target) return null;
            return (
              <div className="space-y-2">
                <div className="text-xs text-text-secondary">
                  Type the league name <span className="font-mono text-text-primary">{target.name}</span> to confirm.
                </div>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={target.name}
                  className="bg-surface-overlay"
                  autoFocus
                />
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteSubmitting || (() => {
                if (!deleteTarget) return true;
                const target = leagueList.find(l => l.id === deleteTarget);
                const phase = leagueStates[deleteTarget]?.phase as Phase | undefined;
                const isLive = phase === 'regular' || phase === 'playoffs';
                return isLive && deleteConfirmText.trim() !== target?.name;
              })()}
              onClick={executeDeleteLeague}
            >
              {deleteSubmitting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force Regenerate Schedule Confirmation */}
      <Dialog open={regenOpen} onOpenChange={(o) => { if (!o) { setRegenOpen(false); setRegenConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Regenerate Schedule (Destructive)
            </DialogTitle>
            <DialogDescription>
              {regenTarget?.name} is in <strong>{regenTarget?.phase}</strong> phase.
              Regenerating will delete every match, including ones with results recorded.
              Standings will be reset.
            </DialogDescription>
          </DialogHeader>
          <div className="text-xs text-text-secondary">
            Type the league name <span className="font-mono text-text-primary">{regenTarget?.name}</span> to confirm.
          </div>
          <Input
            value={regenConfirmText}
            onChange={(e) => setRegenConfirmText(e.target.value)}
            placeholder={regenTarget?.name ?? ''}
            className="bg-surface-overlay"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={regenSubmitting || regenConfirmText.trim() !== regenTarget?.name}
              onClick={executeForcedRegen}
            >
              {regenSubmitting ? 'Regenerating...' : 'Force Regenerate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Playoff Bracket Generation Dialog */}
      <Dialog open={playoffOpen} onOpenChange={(o) => { if (!o) { setPlayoffOpen(false); setPlayoffTarget(null); setPlayoffConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy size={16} className="text-pink" />
              {playoffTarget?.isRegen ? 'Regenerate Playoff Bracket' : 'Generate Playoff Bracket'}
            </DialogTitle>
            <DialogDescription>
              {playoffTarget && (
                <>
                  <strong>{playoffTarget.name}</strong> — top <strong>{playoffTarget.topN}</strong> teams.
                  {playoffTarget.isRegen && (
                    <span className="block mt-1 text-loss text-[11px]">
                      Regenerating will delete every existing playoff match for this league, including ones with results recorded.
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-text-secondary font-medium">Seeding preview</div>
            {playoffPreview.length === 0 ? (
              <div className="text-xs text-text-muted text-center py-4">Loading standings…</div>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto rounded border border-border-subtle">
                {playoffPreview.map(({ teamId, rank }) => (
                  <div key={teamId} className="flex items-center gap-2 px-2 py-1 text-xs">
                    <span className="font-mono text-pink w-6 text-center">#{rank}</span>
                    <span className="text-text-primary font-medium">{teamId}</span>
                  </div>
                ))}
              </div>
            )}
            {playoffTarget?.isRegen && (
              <>
                <div className="text-xs text-text-secondary pt-2">
                  Type the league name <span className="font-mono text-text-primary">{playoffTarget.name}</span> to confirm regeneration.
                </div>
                <Input
                  value={playoffConfirmText}
                  onChange={(e) => setPlayoffConfirmText(e.target.value)}
                  placeholder={playoffTarget.name}
                  className="bg-surface-overlay"
                  autoFocus
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlayoffOpen(false)}>Cancel</Button>
            <Button
              disabled={
                playoffSubmitting ||
                playoffPreview.length === 0 ||
                (playoffTarget?.isRegen && playoffConfirmText.trim() !== playoffTarget?.name)
              }
              className={playoffTarget?.isRegen
                ? 'bg-loss text-surface-base hover:bg-loss/90'
                : 'bg-pink text-surface-base hover:bg-pink/90'}
              onClick={executePlayoffs}
            >
              <Trophy size={12} />
              {playoffSubmitting
                ? 'Generating…'
                : playoffTarget?.isRegen
                  ? 'Regenerate'
                  : 'Generate Bracket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backward Phase Override Dialog */}
      <Dialog open={backwardOpen} onOpenChange={(o) => { if (!o) { setBackwardOpen(false); setBackwardTarget(null); setBackwardConfirmText(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-loss" />
              Revert Phase (Destructive)
            </DialogTitle>
            <DialogDescription>
              {backwardTarget && (
                <>
                  Move <strong>{leagueList.find(l => l.id === backwardTarget.leagueId)?.name}</strong> backward from{' '}
                  <strong>{phaseConfig[backwardTarget.from].label}</strong> to{' '}
                  <strong>{phaseConfig[backwardTarget.to].label}</strong>.
                  <span className="block mt-2 text-loss text-[11px]">
                    Backward phase moves can re-open trade gates, demote brackets, and confuse downstream auto-jobs.
                    This is logged as <span className="font-mono">phase_reverted</span>.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-text-secondary">
              Type <span className="font-mono text-text-primary">I understand</span> to confirm.
            </div>
            <Input
              value={backwardConfirmText}
              onChange={(e) => setBackwardConfirmText(e.target.value)}
              placeholder="I understand"
              className="bg-surface-overlay"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackwardOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={backwardConfirmText.trim() !== 'I understand'}
              onClick={executeBackward}
            >
              Revert Phase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Season Wizard */}
      <NewSeasonWizard open={wizardOpen} onClose={() => setWizardOpen(false)} leagues={leagueList} />
    </div>
  );
}
