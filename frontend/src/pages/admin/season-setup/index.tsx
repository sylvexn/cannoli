import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCog, Check, ChevronLeft, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, type ApiRuleset, type ApiSeasonSetupDefaults } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { getErrorMessage, isApiError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { AdminSection } from '../admin-section';
import { useRulesetTemplates } from '../rulesets/pickers';
import { OverlapConfirmDialog } from '../season/overlap-confirm-dialog';
import { buildPayload, includedLeagues, initDraft } from './logic';
import { useDraft } from './use-draft';
import { StepLeagues } from './step-leagues';
import { StepRules } from './step-rules';
import { StepTeams, useResolvedUsernames } from './step-teams';
import { StepSchedule } from './step-schedule';
import { StepReview } from './step-review';

const STEPS = ['Leagues', 'Rules', 'Teams', 'Schedule', 'Review & create'];

function SetupBody({ defaults, templates }: { defaults: ApiSeasonSetupDefaults; templates: ApiRuleset[] }) {
  const navigate = useNavigate();
  const { refreshLeagues } = useAppData();
  const { draft, patch, restored, discard, clear } = useDraft(() => initDraft(defaults));
  const status = useResolvedUsernames(draft).status;
  const [creating, setCreating] = useState(false);
  const [overlap, setOverlap] = useState<{ priorSeasonNumber: number; priorPhase: string } | null>(null);

  const go = (step: number) => patch({ step, maxStep: Math.max(draft.maxStep, step) });
  const last = STEPS.length - 1;
  const nothing = includedLeagues(draft).length === 0;

  async function create(overlapOverride: boolean) {
    setCreating(true);
    try {
      const r = await api.createSeason(buildPayload(draft, overlapOverride));
      toast.success(`Season ${r.seasonNumber} created: ${r.leagues.length} leagues, ${r.teamsCreated} teams`);
      if (r.unresolvedManagers?.length) toast.warning(`Unresolved managers (assign in Teams tab): ${r.unresolvedManagers.join(', ')}`);
      clear();
      refreshLeagues();
      navigate('/admin/season');
    } catch (err) {
      const b = isApiError(err) ? err.body : undefined;
      if (isApiError(err) && err.status === 409 && b?.error === 'prior_season_active') {
        setOverlap({ priorSeasonNumber: Number(b.priorSeasonNumber), priorPhase: String(b.priorPhase ?? '') });
      } else {
        toast.error(getErrorMessage(err, 'Failed to create season'));
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-mono font-bold uppercase tracking-tight">
          <span className="text-pink">Season</span>{' '}<span>{draft.seasonNumber} Setup</span>
        </h1>
        <span className="ml-auto text-[11px] text-text-muted">autosaved</span>
        {restored && (
          <Button size="sm" variant="outline" className="gap-1" onClick={discard}><RotateCcw size={12} />Discard draft</Button>
        )}
      </div>
      {restored && <div className="text-[11px] text-text-muted -mt-2">Restored your unfinished draft.</div>}

      <div className="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
        <ol className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {STEPS.map((s, i) => {
            const reachable = i <= draft.maxStep;
            return (
              <li key={s} className="shrink-0">
                <button type="button" disabled={!reachable} onClick={() => go(i)}
                  className={cn('w-full flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs',
                    i === draft.step ? 'border-pink bg-pink/10 text-text-primary' : 'border-border-subtle',
                    reachable ? 'hover:border-border-default' : 'opacity-50 cursor-not-allowed text-text-muted')}>
                  <span className="grid place-items-center size-5 rounded-full border border-current text-[10px] font-mono shrink-0">
                    {i < draft.maxStep && i !== draft.step ? <Check size={11} /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">{s}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 space-y-4">
          {draft.step === 0 && <StepLeagues draft={draft} patch={patch} defaults={defaults} templates={templates} latest={defaults.nextSeasonNumber - 1} />}
          {draft.step === 1 && <StepRules draft={draft} patch={patch} defaults={defaults} templates={templates} />}
          {draft.step === 2 && <StepTeams draft={draft} patch={patch} status={status} />}
          {draft.step === 3 && <StepSchedule draft={draft} patch={patch} />}
          {draft.step === 4 && <StepReview draft={draft} defaults={defaults} status={status} />}

          <div className="flex items-center justify-between border-t border-border-subtle pt-3">
            <Button variant="outline" size="sm" className="gap-1" disabled={draft.step === 0} onClick={() => go(draft.step - 1)}>
              <ChevronLeft size={13} />Back
            </Button>
            {draft.step < last ? (
              <Button size="sm" className="gap-1 bg-pink text-surface-base hover:bg-pink/90" disabled={nothing} onClick={() => go(draft.step + 1)}>
                Next<ChevronRight size={13} />
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5 bg-pink text-surface-base hover:bg-pink/90" disabled={nothing || creating} onClick={() => create(false)}>
                {creating && <Loader2 size={13} className="animate-spin" />}Create Season {draft.seasonNumber}
              </Button>
            )}
          </div>
        </div>
      </div>

      <OverlapConfirmDialog
        open={!!overlap}
        onClose={() => setOverlap(null)}
        priorSeasonNumber={overlap?.priorSeasonNumber ?? 0}
        priorPhase={overlap?.priorPhase ?? ''}
        newSeasonNumber={draft.seasonNumber}
        onConfirm={() => { setOverlap(null); void create(true); }}
      />
    </div>
  );
}

export function SeasonSetup() {
  const [defaults, setDefaults] = useState<ApiSeasonSetupDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const templates = useRulesetTemplates();
  useEffect(() => {
    api.getSeasonSetupDefaults().then(setDefaults).catch(e => setError(getErrorMessage(e, 'Failed to load setup defaults')));
  }, []);

  if (error) return <div className="p-4 text-sm text-loss">{error}</div>;
  if (!defaults) return <div className="p-4 text-sm text-text-muted">Loading setup...</div>;
  return <SetupBody defaults={defaults} templates={templates} />;
}

export const SeasonSetupRoute = () => (
  <AdminSection icon={CalendarCog} title="Season Setup"><SeasonSetup /></AdminSection>
);
