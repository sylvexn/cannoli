import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppData } from '@/lib/app-data-context';
// WIP: useAppData exposes League[] (in-memory), but season hooks/cards expect ApiLeague[]
// (wire format). Cast at boundary until the types are unified.
import { api, type ApiLeague } from '@/lib/api';
import { Sparkles, Plus } from 'lucide-react';
import { type EditableLeague } from './season/phase-config';
import { LeagueEditDialog } from './season/league-edit-dialog';
import { DraftOrderEditor } from './season/draft-order-editor';
import { SeasonLeagueCard } from './season/season-league-card';
import { SeasonScheduleDates } from './season/season-schedule-dates';
import { SeasonArchiveSection } from './season/season-archive-section';
import { SeasonConfirmDialogs } from './season/season-confirm-dialogs';
import { SeasonPlayoffDialog } from './season/season-playoff-dialog';
import { SeasonBackwardPhaseDialog } from './season/season-backward-phase-dialog';
import { useSeasonArchive } from './season/use-season-archive';
import { useDraftStates } from './season/use-draft-states';
import { usePhaseControls } from './season/use-phase-controls';
import { usePlayoffControls } from './season/use-playoff-controls';
import { useLeagueMutations } from './season/use-league-mutations';

type SLeague = ApiLeague & { season: NonNullable<ApiLeague['season']> };
const PHASE_ORDER = ['predraft', 'draft', 'regular', 'playoffs'] as const;

/** All offseason -> "finished"; else the earliest non-offseason phase. */
function seasonPhase(ls: SLeague[]): string {
  const live = PHASE_ORDER.find(p => ls.some(l => l.season.phase === p));
  return live ?? 'finished';
}

export function AdminSeason() {
  const { refreshLeagues: refreshApp } = useAppData();
  const navigate = useNavigate();
  // /api/leagues only returns the latest season; ?all=1 lets an older, still-running season stay reachable.
  const [allLeagues, setAllLeagues] = useState<SLeague[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const loadAll = useCallback(() => { api.getLeagues(true).then(ls => setAllLeagues(ls.filter((l): l is SLeague => !!l.season))).catch(() => {}); }, []);
  useEffect(loadAll, [loadAll]);
  const refreshLeagues = useCallback(() => { refreshApp(); loadAll(); }, [refreshApp, loadAll]);

  const seasonNums = useMemo(
    () => [...new Set(allLeagues.map(l => l.season.seasonNumber))].sort((a, b) => b - a), [allLeagues]);
  const selected = picked ?? seasonNums[0] ?? null;
  const defaultLeagues = useMemo(
    () => allLeagues.filter(l => l.season.seasonNumber === selected), [allLeagues, selected]);
  const label = (n: number) => {
    const ls = allLeagues.filter(l => l.season.seasonNumber === n);
    return `Season ${n} · ${seasonPhase(ls)} · ${ls.length} league${ls.length === 1 ? '' : 's'}`;
  };

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

  // League CRUD + force-regen flows
  const mut = useLeagueMutations({ leagueList, leagueStates, refreshLeagues });

  // Phase advance / week tick / backward override flows
  const phase = usePhaseControls({ leagueList, leagueStates, refreshLeagues });

  // Playoff bracket detection + generate/regenerate flow
  const playoff = usePlayoffControls(defaultLeagues, refreshLeagues);

  // Season archive list (read-only, with toggle + full ceremony).
  // Pass refreshLeagues so a successful ceremony also refreshes the app-wide
  // league cache — otherwise league pages don't show the read-only badge
  // until a manual reload.
  const { seasonsList, toggleArchive, archiveCeremony } = useSeasonArchive(refreshLeagues);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 text-sm">
        <Select value={selected != null ? String(selected) : ''} onValueChange={v => setPicked(Number(v))}>
          <SelectTrigger className="h-8 w-full max-w-[280px] text-xs font-mono">
            <SelectValue placeholder="Season">{selected != null ? label(selected) : 'Season'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {seasonNums.map(n => <SelectItem key={n} value={String(n)} className="text-xs">{label(n)}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Leagues:</span>
          <span className="text-text-primary font-medium font-mono">{leagueList.length}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={mut.openNewLeague}>
            <Plus size={14} />
            Add League
          </Button>
          <Button size="sm" onClick={() => navigate('/admin/season/new')} className="bg-pink text-surface-base hover:bg-pink/90">
            <Sparkles size={14} />
            Set up Season {(seasonNums[0] ?? 0) + 1}
          </Button>
        </div>
      </div>

      {/* Selected-season summary */}
      <div className="flex flex-wrap gap-2">
        {defaultLeagues.map(l => (
          <div key={l.id} className="flex items-center gap-1.5 rounded-md border border-border-subtle px-2 py-1 text-xs min-w-0">
            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
            <span className="truncate min-w-0 text-text-primary">{l.name}</span>
            <Badge variant="outline" className="text-[10px] shrink-0">{l.season.phase}</Badge>
            <span className="font-mono text-text-muted shrink-0">{l.playerCount ?? 0} teams</span>
          </div>
        ))}
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
              playoffInfo={playoff.playoffInfo[league.id]}
              onEditLeague={mut.openEditLeague}
              onDeleteLeague={mut.confirmDeleteLeague}
              onStartDraft={handleStartDraft}
              onPauseDraft={handlePauseDraft}
              onResumeDraft={handleResumeDraft}
              onOpenPlayoffsDialog={playoff.openPlayoffsDialog}
              onGenerateSchedule={mut.handleGenerateSchedule}
              onConfirmWeekAdvance={phase.confirmWeekAdvance}
              onConfirmAdvance={phase.confirmAdvance}
              onConfirmBackward={phase.confirmBackward}
              onRefreshLeagues={refreshLeagues}
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
      <SeasonArchiveSection
        seasonsList={seasonsList}
        onToggleArchive={toggleArchive}
        onArchiveCeremony={archiveCeremony}
      />

      {/* Schedule Dates */}
      <SeasonScheduleDates
        leagueList={leagueList}
        leagueStates={leagueStates as Record<string, { totalWeeks: number; weekDates?: Record<string, string>; weekDatesAutoFilled?: boolean } & Record<string, unknown>>}
        defaultLeagues={defaultLeagues}
        refreshLeagues={refreshLeagues}
      />

      {/* Standard advance / week / delete / regen confirmation dialogs */}
      <SeasonConfirmDialogs
        leagueList={leagueList}
        leagueStates={leagueStates}
        advanceOpen={phase.advanceOpen}
        setAdvanceOpen={phase.setAdvanceOpen}
        advanceTarget={phase.advanceTarget}
        onExecuteAdvance={phase.executeAdvance}
        weekOpen={phase.weekOpen}
        setWeekOpen={phase.setWeekOpen}
        weekTarget={phase.weekTarget}
        onExecuteWeekAdvance={phase.executeWeekAdvance}
        deleteOpen={mut.deleteOpen}
        setDeleteOpen={mut.setDeleteOpen}
        deleteTarget={mut.deleteTarget}
        deleteConfirmText={mut.deleteConfirmText}
        setDeleteConfirmText={mut.setDeleteConfirmText}
        deleteSubmitting={mut.deleteSubmitting}
        onExecuteDeleteLeague={mut.executeDeleteLeague}
        regenOpen={mut.regenOpen}
        setRegenOpen={mut.setRegenOpen}
        regenTarget={mut.regenTarget}
        regenConfirmText={mut.regenConfirmText}
        setRegenConfirmText={mut.setRegenConfirmText}
        regenSubmitting={mut.regenSubmitting}
        onExecuteForcedRegen={mut.executeForcedRegen}
      />

      {/* League Edit Dialog */}
      <LeagueEditDialog
        open={mut.leagueEditOpen}
        onOpenChange={mut.setLeagueEditOpen}
        editingLeague={mut.editingLeague}
        editName={mut.editName}
        setEditName={mut.setEditName}
        editColor={mut.editColor}
        setEditColor={mut.setEditColor}
        onSave={mut.saveLeague}
      />

      {/* Playoff Bracket Generation Dialog */}
      <SeasonPlayoffDialog
        playoffOpen={playoff.playoffOpen}
        setPlayoffOpen={playoff.setPlayoffOpen}
        playoffTarget={playoff.playoffTarget}
        setPlayoffTarget={playoff.setPlayoffTarget}
        playoffTeams={playoff.playoffTeams}
        seedOrder={playoff.seedOrder}
        setSeedOrder={playoff.setSeedOrder}
        moveSeed={playoff.moveSeed}
        resetSeeding={playoff.resetSeeding}
        playoffConfirmText={playoff.playoffConfirmText}
        setPlayoffConfirmText={playoff.setPlayoffConfirmText}
        playoffSubmitting={playoff.playoffSubmitting}
        onExecutePlayoffs={playoff.executePlayoffs}
      />

      {/* Backward Phase Override Dialog */}
      <SeasonBackwardPhaseDialog
        leagueList={leagueList}
        backwardOpen={phase.backwardOpen}
        setBackwardOpen={phase.setBackwardOpen}
        backwardTarget={phase.backwardTarget}
        setBackwardTarget={phase.setBackwardTarget}
        backwardConfirmText={phase.backwardConfirmText}
        setBackwardConfirmText={phase.setBackwardConfirmText}
        onExecuteBackward={phase.executeBackward}
      />
    </div>
  );
}
