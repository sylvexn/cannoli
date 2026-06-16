/**
 * Trade Composer — the single, simple trade-proposal dialog for the Market.
 *
 * Replaces the old clunky propose dialog + 4-step wizard. The user proposes AS
 * their acting team (`proposerTeam`, FIXED — no "your team" dropdown). They pick
 * a partner, pick what they give and get, watch live legality, and send. All the
 * points/cap/legality math lives in <LegalityMeter/> + validateTrade — this file
 * just wires selections to those.
 */
import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { ArrowRightLeft, Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isMegaForm } from '@/lib/draft-rules';
import { validateTrade } from '@/lib/trade-validation';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';
import { LegalityMeter } from '@/pages/market/trade-bits';
import type { Player, Trade } from '@/lib/types';

export interface TradeComposerProps {
  open: boolean;
  /** Parent reloads trades on close. */
  onClose: () => void;
  /** The acting team — proposes AS this team (FIXED, no dropdown). */
  proposerTeam: Player;
  /** Pre-selected partner (e.g. clicked a block listing). */
  recipientTeamId?: string | null;
  /** Pre-selected "you get" mons (e.g. clicked a listing). */
  preselectRequesting?: string[];
  /** If set → this is a counter to an existing trade. */
  counterTo?: Trade | null;
}

export function TradeComposer({
  open,
  onClose,
  proposerTeam,
  recipientTeamId,
  preselectRequesting,
  counterTo,
}: TradeComposerProps): React.ReactElement {
  const league = useLeague();
  const { players } = useLeagueData();
  const pointCap = league.season.pointCap ?? 110;

  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // (Re)initialise whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (counterTo) {
      // Counter — proposerTeam is already the acting team (= original
      // recipient). The swap is the original mirrored: we give what they
      // requested, we get what they offered.
      setPartnerId(counterTo.proposer);
      setOffering(new Set(counterTo.requesting));
      setRequesting(new Set(counterTo.offering));
    } else {
      setPartnerId(recipientTeamId ?? null);
      setOffering(new Set());
      setRequesting(new Set(preselectRequesting ?? []));
    }
    setSubmitError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const partnerTeam = (partnerId ? players.find(p => p.id === partnerId) : null) ?? null;

  // Partner list — everyone except the acting team.
  const partnerOptions = players.filter(p => p.id !== proposerTeam.id);

  function handlePartnerChange(id: string | null) {
    setPartnerId(id);
    // A different roster means the old "you get" picks no longer apply.
    setRequesting(new Set());
  }

  function toggle(name: string, set: Set<string>, setFn: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFn(next);
  }

  // Gate Send: validator must pass AND both sides must have picks.
  const issues = partnerTeam
    ? validateTrade({ proposer: proposerTeam, recipient: partnerTeam, offering, requesting, pointCap })
    : [];
  const canSubmit =
    !!partnerTeam &&
    offering.size > 0 &&
    requesting.size > 0 &&
    issues.length === 0 &&
    !submitting;

  async function handleSubmit() {
    if (!partnerTeam) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (counterTo) {
        await api.counterTrade(counterTo.id, {
          offering: [...offering],
          requesting: [...requesting],
        });
        toast.success('Counter-proposal sent!');
      } else {
        await api.proposeTrade(league.id, {
          recipientId: partnerTeam.id,
          offering: [...offering],
          requesting: [...requesting],
          proposerId: proposerTeam.id,
        });
        toast.success('Trade proposal sent!');
      }
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-neon" />
            {counterTo ? 'Counter Trade' : 'Propose Trade'}
          </DialogTitle>
          <DialogDescription>
            {counterTo
              ? 'Edit the swap and send your counter — the original proposal will be closed.'
              : 'Pick a partner, choose what you give and get, then send. Trades need admin approval.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Partner selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-wider text-text-muted">
              Trade with
            </label>
            <Select value={partnerId ?? ''} onValueChange={handlePartnerChange}>
              <SelectTrigger className="h-9 text-xs bg-surface-overlay">
                <SelectValue placeholder="Select a team…" />
              </SelectTrigger>
              <SelectContent>
                {partnerOptions.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <span className="flex items-center gap-1.5">
                      <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" logoPath={p.logoPath} />
                      <span className="font-medium">{p.teamAbbrev}</span>
                      <span className="text-text-muted">— {p.teamName}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Roster pickers */}
          <div className="grid grid-cols-2 gap-4">
            <RosterPicker
              label="You give"
              tone="loss"
              team={proposerTeam}
              selected={offering}
              onToggle={name => toggle(name, offering, setOffering)}
            />
            <RosterPicker
              label="You get"
              tone="win"
              team={partnerTeam}
              placeholder="Pick a partner to see their roster"
              selected={requesting}
              onToggle={name => toggle(name, requesting, setRequesting)}
            />
          </div>

          {/* Live legality + points impact */}
          {partnerTeam && (
            <LegalityMeter
              proposer={proposerTeam}
              recipient={partnerTeam}
              offering={offering}
              requesting={requesting}
              pointCap={pointCap}
              submitError={submitError}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-30 gap-1.5"
          >
            <Send size={14} />
            {submitting ? 'Sending…' : counterTo ? 'Send Counter' : 'Send Proposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Roster picker ───────────────────────────────────────────────────────────

const TONE: Record<'win' | 'loss', { text: string; border: string }> = {
  win: { text: 'text-win', border: 'border-win/30' },
  loss: { text: 'text-loss', border: 'border-loss/30' },
};

/** One team's roster as a scrollable multi-select. Full sprite + name + tier. */
function RosterPicker({
  label,
  tone,
  team,
  selected,
  onToggle,
  placeholder = 'Select a team to see their roster',
}: {
  label: string;
  tone: 'win' | 'loss';
  team: Player | null;
  selected: Set<string>;
  onToggle: (name: string) => void;
  placeholder?: string;
}) {
  const t = TONE[tone];

  if (!team) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-border-subtle p-4 text-center text-xs text-text-muted min-h-[260px]">
        {placeholder}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
        <span className="text-xs font-medium text-text-primary truncate">{team.teamAbbrev}</span>
        <span className={cn('text-[11px] font-mono uppercase tracking-wider', t.text)}>{label}</span>
        {selected.size > 0 && (
          <Badge variant="outline" className={cn('text-[11px] ml-auto', t.text, t.border)}>
            {selected.size}
          </Badge>
        )}
      </div>
      <div className="rounded-md border border-border-subtle max-h-[260px] overflow-y-auto">
        {team.roster.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-text-muted">No Pokemon on roster</div>
        )}
        {team.roster.map(mon => {
          const isSelected = selected.has(mon.name);
          return (
            <button
              key={mon.name}
              type="button"
              onClick={() => onToggle(mon.name)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                'hover:bg-surface-overlay/40',
                isSelected && 'bg-neon/5',
              )}
            >
              <span
                className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                  isSelected ? 'bg-neon border-neon text-surface-base' : 'border-border-subtle',
                )}
              >
                {isSelected && <Check size={11} />}
              </span>
              <PokemonSprite name={mon.name} size="xs" />
              <span className="text-xs text-text-primary flex-1 min-w-0 truncate">{mon.name}</span>
              {isMegaForm(mon.name) && (
                <Badge variant="outline" className="text-[11px] px-1 py-0 text-purple-400 border-purple-400/30">
                  M
                </Badge>
              )}
              <TierBadge points={mon.tier} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
