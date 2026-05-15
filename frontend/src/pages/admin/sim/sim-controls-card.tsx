/**
 * Simulator action controls — per league.
 *
 * Buttons: Advance Week, Sim Full Week (NumberInput picker), Sim Next Match,
 * Auto-Complete Draft, Generate Playoffs, Jump to Phase (Select + override /
 * confirm flow). Every action toasts and calls onChanged() to refetch /state.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  SkipForward, CalendarRange, Swords, ListChecks, Trophy, ArrowRightLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api, type ApiSimLeague } from '@/lib/api';

const PHASES = ['predraft', 'draft', 'regular', 'playoffs', 'offseason'] as const;

interface Props {
  league: ApiSimLeague;
  onChanged: () => void;
}

export function SimControlsCard({ league, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [weekPick, setWeekPick] = useState(Math.max(1, league.currentWeek || 1));
  const [phasePick, setPhasePick] = useState<string>(league.phase);
  const [phaseConfirmOpen, setPhaseConfirmOpen] = useState(false);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      const msg = await fn();
      toast.success(msg);
      onChanged();
    } catch (err: any) {
      toast.error(err?.message ?? 'Simulator action failed');
    } finally {
      setBusy(null);
    }
  }

  const advanceWeek = () => run('advance', async () => {
    const r = await api.simAdvanceWeek(league.id);
    return `${league.name}: advanced to week ${r.weekAfter} (${r.matchesPlayed} matches played)`;
  });

  const simFullWeek = () => run('week', async () => {
    const r = await api.simWeek(league.id, weekPick);
    return `${league.name}: simulated through week ${r.throughWeek} (${r.matchesPlayed} matches)`;
  });

  // Sim Next Match — resolve the current week's remaining matches. The
  // per-match endpoint needs a matchId we don't have here, so we sim the
  // current week (idempotent for already-played matches).
  const simOneMatch = () => run('match', async () => {
    const week = league.currentWeek || 1;
    const r = await api.simWeek(league.id, week);
    return `${league.name}: resolved week ${week} (${r.matchesPlayed} matches)`;
  });

  const autoDraft = () => run('draft', async () => {
    const r = await api.simAutoCompleteDraft(league.id);
    return `${league.name}: draft auto-completed (${r.picks} picks, ${r.captainsAssigned} captains)`;
  });

  const genPlayoffs = () => run('playoffs', async () => {
    const r = await api.simGeneratePlayoffs(league.id);
    return `${league.name}: playoffs simulated (${r.matchesPlayed} matches, champion crowned)`;
  });

  async function executePhaseJump(override: boolean) {
    setPhaseConfirmOpen(false);
    await run('phase', async () => {
      const r = await api.simPhase(league.id, phasePick, override ? { override: true, confirm: true } : {});
      return `${league.name}: phase ${r.from} → ${r.to} (${r.teams} teams)`;
    });
  }

  function attemptPhaseJump() {
    const curIdx = PHASES.indexOf(league.phase as any);
    const tgtIdx = PHASES.indexOf(phasePick as any);
    if (phasePick === league.phase) {
      toast.info('League is already in that phase');
      return;
    }
    // Backward moves or skips need the override/confirm flow.
    if (tgtIdx < curIdx || tgtIdx > curIdx + 1) {
      setPhaseConfirmOpen(true);
      return;
    }
    executePhaseJump(false);
  }

  const anyBusy = busy !== null;

  return (
    <div className="rounded-lg border border-border-default bg-surface-base/60 p-3 space-y-3">
      <h3 className="text-sm font-mono font-bold uppercase tracking-tight text-text-primary truncate">
        {league.name}
      </h3>

      {/* Primary sim actions */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline" size="sm"
          className="h-8 justify-start text-[11px]"
          disabled={anyBusy}
          onClick={advanceWeek}
        >
          <SkipForward size={13} className="text-neon" />
          {busy === 'advance' ? 'Advancing…' : 'Advance Week'}
        </Button>
        <Button
          variant="outline" size="sm"
          className="h-8 justify-start text-[11px]"
          disabled={anyBusy}
          onClick={simOneMatch}
        >
          <Swords size={13} className="text-draw" />
          {busy === 'match' ? 'Simming…' : 'Sim Next Match'}
        </Button>
        <Button
          variant="outline" size="sm"
          className="h-8 justify-start text-[11px]"
          disabled={anyBusy}
          onClick={autoDraft}
        >
          <ListChecks size={13} className="text-pink" />
          {busy === 'draft' ? 'Drafting…' : 'Auto-Complete Draft'}
        </Button>
        <Button
          variant="outline" size="sm"
          className="h-8 justify-start text-[11px]"
          disabled={anyBusy}
          onClick={genPlayoffs}
        >
          <Trophy size={13} className="text-draw" />
          {busy === 'playoffs' ? 'Simming…' : 'Generate Playoffs'}
        </Button>
      </div>

      {/* Sim full week — picker + run */}
      <div className="flex items-end gap-2 rounded-md border border-border-subtle bg-surface-overlay/40 p-2">
        <div className="flex-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted mb-1">
            Sim through week
          </div>
          <NumberInput
            value={weekPick}
            onChange={setWeekPick}
            min={1}
            max={league.totalWeeks || 99}
            className="h-8 bg-surface-base"
          />
        </div>
        <Button
          variant="outline" size="sm"
          className="h-8 text-[11px]"
          disabled={anyBusy}
          onClick={simFullWeek}
        >
          <CalendarRange size={13} className="text-neon" />
          {busy === 'week' ? 'Simming…' : 'Sim Full Week'}
        </Button>
      </div>

      {/* Jump to phase */}
      <div className="flex items-end gap-2 rounded-md border border-border-subtle bg-surface-overlay/40 p-2">
        <div className="flex-1">
          <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted mb-1">
            Jump to phase
          </div>
          <Select value={phasePick} onValueChange={(v) => v && setPhasePick(v)}>
            <SelectTrigger className="h-8 bg-surface-base text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PHASES.map(p => (
                <SelectItem key={p} value={p} className="text-[11px] capitalize">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline" size="sm"
          className="h-8 text-[11px]"
          disabled={anyBusy}
          onClick={attemptPhaseJump}
        >
          <ArrowRightLeft size={13} className="text-pink" />
          {busy === 'phase' ? 'Jumping…' : 'Jump'}
        </Button>
      </div>

      {/* Override confirm — backward / skip phase jumps */}
      <Dialog open={phaseConfirmOpen} onOpenChange={setPhaseConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-draw" />
              Override Phase Jump
            </DialogTitle>
            <DialogDescription>
              Jumping <strong>{league.name}</strong> from <strong>{league.phase}</strong> to{' '}
              <strong>{phasePick}</strong> is not a normal forward step. This requires an
              override and may reset downstream data (matches, standings, draft state).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPhaseConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-draw text-surface-base hover:bg-draw/90"
              onClick={() => executePhaseJump(true)}
            >
              Override &amp; Jump
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
