import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Sparkles, Plus } from 'lucide-react';
import { phaseConfig, getNextPhase, PRESET_COLORS, type EditableLeague, type Phase } from './season/phase-config';
import { LeagueEditDialog } from './season/league-edit-dialog';
import { NewSeasonWizard } from './season/new-season-wizard';
import { DraftOrderEditor } from './season/draft-order-editor';
import { SeasonLeagueCard } from './season/season-league-card';
import { SeasonScheduleDates } from './season/season-schedule-dates';
import { SeasonArchiveSection } from './season/season-archive-section';
import { SeasonConfirmDialogs } from './season/season-confirm-dialogs';
import { SeasonPlayoffDialog } from './season/season-playoff-dialog';
import { SeasonBackwardPhaseDialog } from './season/season-backward-phase-dialog';
import { useSeasonArchive } from './season/use-season-archive';
import { useDraftStates } from './season/use-draft-states';

export function AdminSeason() {
  const { leagues: defaultLeagues, refreshLeagues } = useAppData();

  const [leagueList, setLeagueList] = useState<EditableLeague[]>(
    defaultLeagues.map(l => ({ id: l.id, name: l.name, color: l.color }))
  );

  const [leagueStates, setLeagueStates] = useState(
    Object.fromEntries(defaultLeagues.map(l => [l.id, { ...l.season }]))
  );

  // Draft state per league + start/pause/resume actions
  const { draftStates, handleStartDraft, handlePauseDraft, handleResumeDraft } = useDraftStates(defaultLeagues);

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

  // Season archive list (read-only, with toggle)
  const { seasonsList, toggleArchive } = useSeasonArchive();

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
          return (
            <SeasonLeagueCard
              key={league.id}
              league={league}
              state={state}
              draftState={draftStates[league.id]}
              apiLeague={defaultLeagues.find(l => l.id === league.id)}
              playoffInfo={playoffInfo[league.id]}
              onEditLeague={openEditLeague}
              onDeleteLeague={confirmDeleteLeague}
              onStartDraft={handleStartDraft}
              onPauseDraft={handlePauseDraft}
              onResumeDraft={handleResumeDraft}
              onOpenPlayoffsDialog={openPlayoffsDialog}
              onGenerateSchedule={handleGenerateSchedule}
              onConfirmWeekAdvance={confirmWeekAdvance}
              onConfirmAdvance={confirmAdvance}
              onConfirmBackward={confirmBackward}
            />
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

      {/* Season Archive — read-only gate for historical seasons */}
      <SeasonArchiveSection seasonsList={seasonsList} onToggleArchive={toggleArchive} />

      {/* Schedule Dates */}
      <SeasonScheduleDates
        leagueList={leagueList}
        leagueStates={leagueStates}
        defaultLeagues={defaultLeagues}
        refreshLeagues={refreshLeagues}
      />

      {/* Standard advance / week / delete / regen confirmation dialogs */}
      <SeasonConfirmDialogs
        leagueList={leagueList}
        leagueStates={leagueStates}
        advanceOpen={advanceOpen}
        setAdvanceOpen={setAdvanceOpen}
        advanceTarget={advanceTarget}
        onExecuteAdvance={executeAdvance}
        weekOpen={weekOpen}
        setWeekOpen={setWeekOpen}
        weekTarget={weekTarget}
        onExecuteWeekAdvance={executeWeekAdvance}
        deleteOpen={deleteOpen}
        setDeleteOpen={setDeleteOpen}
        deleteTarget={deleteTarget}
        deleteConfirmText={deleteConfirmText}
        setDeleteConfirmText={setDeleteConfirmText}
        deleteSubmitting={deleteSubmitting}
        onExecuteDeleteLeague={executeDeleteLeague}
        regenOpen={regenOpen}
        setRegenOpen={setRegenOpen}
        regenTarget={regenTarget}
        regenConfirmText={regenConfirmText}
        setRegenConfirmText={setRegenConfirmText}
        regenSubmitting={regenSubmitting}
        onExecuteForcedRegen={executeForcedRegen}
      />

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

      {/* Playoff Bracket Generation Dialog */}
      <SeasonPlayoffDialog
        playoffOpen={playoffOpen}
        setPlayoffOpen={setPlayoffOpen}
        playoffTarget={playoffTarget}
        setPlayoffTarget={setPlayoffTarget}
        playoffPreview={playoffPreview}
        playoffConfirmText={playoffConfirmText}
        setPlayoffConfirmText={setPlayoffConfirmText}
        playoffSubmitting={playoffSubmitting}
        onExecutePlayoffs={executePlayoffs}
      />

      {/* Backward Phase Override Dialog */}
      <SeasonBackwardPhaseDialog
        leagueList={leagueList}
        backwardOpen={backwardOpen}
        setBackwardOpen={setBackwardOpen}
        backwardTarget={backwardTarget}
        setBackwardTarget={setBackwardTarget}
        backwardConfirmText={backwardConfirmText}
        setBackwardConfirmText={setBackwardConfirmText}
        onExecuteBackward={executeBackward}
      />

      {/* New Season Wizard */}
      <NewSeasonWizard open={wizardOpen} onClose={() => setWizardOpen(false)} leagues={leagueList} />
    </div>
  );
}
