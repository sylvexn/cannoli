import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowRightLeft, Send, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { useAuth } from '@/lib/auth-context';
import { isTeamOwner } from '@/lib/permissions';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { PickTeamsStep } from './step-pick-teams';
import { BrowseRostersStep } from './step-browse-rosters';
import { SelectStep } from './step-select';
import { ReviewStep } from './step-review';
import { validateTrade } from './validation';
import { getErrorMessage } from '@/lib/errors';

type WizardStep = 'teams' | 'browse' | 'select' | 'review';

const STEPS: { value: WizardStep; label: string }[] = [
  { value: 'teams', label: 'Pick teams' },
  { value: 'browse', label: 'Browse rosters' },
  { value: 'select', label: 'Select Pokemon' },
  { value: 'review', label: 'Review & confirm' },
];

interface TradeWizardProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Trade Wizard — multi-step companion to the quick-propose dialog. Guides the
 * user through picking the partner team, exploring rosters, choosing the
 * specific Pokemon, and reviewing the points/cap/mega impact before submitting
 * through the same `proposeTrade` endpoint.
 *
 * Submits via the regular trade-create endpoint; if the backend rejects (e.g.
 * trade deadline has passed in seeded data), the error is surfaced inside the
 * Review step and the user can step back without losing context.
 */
export function TradeWizard({ open, onClose }: TradeWizardProps) {
  const league = useLeague();
  const { user } = useAuth();
  const { players } = useLeagueData();
  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const pointCap = league.season.pointCap ?? 110;

  const myTeam = useMemo(
    () => players.find(p => isTeamOwner(user, p)) ?? null,
    [players, user],
  );

  const [step, setStep] = useState<WizardStep>('teams');
  const [proposerTeamId, setProposerTeamId] = useState<string | null>(myTeam?.id ?? null);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset on open so re-entries don't carry stale picks.
  useEffect(() => {
    if (open) {
      setStep('teams');
      setProposerTeamId(myTeam?.id ?? null);
      setRecipientId(null);
      setOffering(new Set());
      setRequesting(new Set());
      setSubmitError(null);
    }
  }, [open, myTeam?.id]);

  const proposer = proposerTeamId ? playerMap.get(proposerTeamId) ?? null : null;
  const recipient = recipientId ? playerMap.get(recipientId) ?? null : null;

  const validationIssues = useMemo(() => {
    if (!proposer || !recipient) return [];
    return validateTrade({ proposer, recipient, offering, requesting, pointCap });
  }, [proposer, recipient, offering, requesting, pointCap]);

  function toggleOffering(name: string) {
    setOffering(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleRequesting(name: string) {
    setRequesting(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Reset selection sets when teams change (otherwise stale names linger).
  function handleSetProposer(id: string) {
    setProposerTeamId(id);
    setOffering(new Set());
  }
  function handleSetRecipient(id: string) {
    setRecipientId(id);
    setRequesting(new Set());
  }

  const stepIdx = STEPS.findIndex(s => s.value === step);
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === STEPS.length - 1;

  const canAdvance = (() => {
    switch (step) {
      case 'teams':   return !!proposerTeamId && !!recipientId;
      case 'browse':  return !!proposer && !!recipient;
      case 'select':  return offering.size > 0 && requesting.size > 0;
      case 'review':  return false; // last step — submit, not advance
    }
  })();

  const hasSelections = !!proposerTeamId && !!recipientId && offering.size > 0 && requesting.size > 0;
  const isLegal = validationIssues.length === 0;
  const canSubmit = hasSelections && isLegal && !submitting;

  function next() {
    if (isLast) return;
    setStep(STEPS[stepIdx + 1]!.value);
  }
  function back() {
    if (isFirst) return;
    setStep(STEPS[stepIdx - 1]!.value);
    // Clearing the submit error on back so a previous "deadline passed" doesn't
    // shadow a fresh attempt with different picks.
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (!proposerTeamId || !recipientId || offering.size === 0 || requesting.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.proposeTrade(league.id, {
        recipientId,
        offering: [...offering],
        requesting: [...requesting],
        proposerId: proposerTeamId,
      });
      toast.success('Trade proposal sent!');
      onClose();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to send proposal');
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-purple-400" />
            Trade Wizard
            <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Step {stepIdx + 1} of {STEPS.length} · {STEPS[stepIdx]!.label}
            </span>
          </DialogTitle>
          <DialogDescription>
            Walk through partner selection, roster browse, picks, and review. Submits to the same admin queue as the quick propose flow.
          </DialogDescription>
        </DialogHeader>

        {/* Step pip indicator */}
        <div className="flex items-center gap-1.5 px-1">
          {STEPS.map((s, i) => (
            <div
              key={s.value}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= stepIdx ? 'bg-purple-400' : 'bg-surface-overlay',
              )}
            />
          ))}
        </div>

        <div className="min-h-[320px]">
          {step === 'teams' && (
            <PickTeamsStep
              players={players}
              proposerTeamId={proposerTeamId}
              recipientId={recipientId}
              setProposerTeamId={handleSetProposer}
              setRecipientId={handleSetRecipient}
            />
          )}
          {step === 'browse' && (
            <BrowseRostersStep proposer={proposer} recipient={recipient} />
          )}
          {step === 'select' && (
            <SelectStep
              proposer={proposer}
              recipient={recipient}
              offering={offering}
              requesting={requesting}
              toggleOffering={toggleOffering}
              toggleRequesting={toggleRequesting}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              proposer={proposer}
              recipient={recipient}
              offering={offering}
              requesting={requesting}
              pointCap={pointCap}
              validationIssues={validationIssues}
              submitError={submitError}
            />
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="outline" onClick={back} disabled={isFirst} className="gap-1">
            <ChevronLeft size={14} /> Back
          </Button>
          {isLast ? (
            <Button
              disabled={!canSubmit}
              className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-30 gap-1.5"
              onClick={handleSubmit}
            >
              <Send size={14} />
              {submitting ? 'Sending...' : 'Send Proposal'}
            </Button>
          ) : (
            <Button
              disabled={!canAdvance}
              onClick={next}
              className="bg-purple-400 text-surface-base hover:bg-purple-400/90 disabled:opacity-30 gap-1"
            >
              Next <ChevronRight size={14} />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
