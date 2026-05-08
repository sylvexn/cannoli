import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ArrowRightLeft, Check, Send, AlertCircle } from 'lucide-react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { isTeamOwner } from '@/lib/permissions';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { isMegaForm, getBaseFormName } from '@/lib/draft-rules';
import type { Player, RosterPokemon, Trade } from '@/lib/types';

interface TradeProposeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected recipient team ID (from clicking a trade block listing) */
  recipientTeamId?: string | null;
  /**
   * If set, this dialog acts as a counter-proposal builder. Pre-fills:
   *   - proposer = original recipient (i.e. the user countering)
   *   - recipient = original proposer
   *   - offering / requesting = swapped from the original (start as the
   *     original requesting/offering) so the user can edit from a sensible
   *     starting point. Submits via api.counterTrade(originalId, ...).
   */
  counterTo?: Trade | null;
}

interface ValidationIssue {
  side: 'offering' | 'requesting';
  message: string;
}

/**
 * Validate post-trade rosters against:
 *   - point cap (using mon.tier — locked at draft, mirrors backend costAtDraft)
 *   - max 1 mega per team
 *   - no duplicate species (proxy for national-dex check; backend re-verifies)
 *
 * Returns one issue per failed rule per side. Empty array = legal.
 */
function validateTrade(opts: {
  proposer: Player;
  recipient: Player;
  offering: Set<string>;
  requesting: Set<string>;
  pointCap: number;
}): ValidationIssue[] {
  const { proposer, recipient, offering, requesting, pointCap } = opts;
  const issues: ValidationIssue[] = [];

  if (offering.size === 0 || requesting.size === 0) return issues;

  const offered = proposer.roster.filter(m => offering.has(m.name));
  const requested = recipient.roster.filter(m => requesting.has(m.name));

  // Build post-trade rosters
  const postProposer: RosterPokemon[] = [
    ...proposer.roster.filter(m => !offering.has(m.name)),
    ...requested,
  ];
  const postRecipient: RosterPokemon[] = [
    ...recipient.roster.filter(m => !requesting.has(m.name)),
    ...offered,
  ];

  function check(side: 'offering' | 'requesting', label: string, roster: RosterPokemon[]) {
    const total = roster.reduce((s, m) => s + (m.tier || 0), 0);
    if (total > pointCap) {
      issues.push({ side, message: `${label} would exceed point cap (${total} > ${pointCap})` });
    }

    const megas = roster.filter(m => isMegaForm(m.name));
    if (megas.length > 1) {
      issues.push({ side, message: `${label} would have ${megas.length} megas (${megas.map(m => m.name).join(', ')}) — max 1` });
    }

    const baseSeen = new Map<string, string>();
    for (const m of roster) {
      const base = getBaseFormName(m.name);
      const prev = baseSeen.get(base);
      if (prev && prev !== m.name) {
        issues.push({ side, message: `${label} would have duplicate species: ${prev} + ${m.name}` });
        break;
      }
      baseSeen.set(base, m.name);
    }
  }

  check('offering', 'Your team', postProposer);
  check('requesting', recipient.teamAbbrev, postRecipient);

  return issues;
}

export function TradeProposeDialog({ open, onClose, recipientTeamId, counterTo }: TradeProposeDialogProps) {
  const league = useLeague();
  const { user } = useAuth();
  const { players } = useLeagueData();
  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);
  const pointCap = league.season.pointCap ?? 110;

  // Default the proposer side to the current user's owned team in this
  // league, if any. Staff (admin/dev) typically don't own a team here so
  // they fall through to picking a proposer manually — the team selector
  // already lists every team.
  const myTeam = useMemo(
    () => players.find(p => isTeamOwner(user, p)) ?? null,
    [players, user],
  );

  const [proposerTeamId, setProposerTeamId] = useState<string | null>(myTeam?.id ?? null);
  const [recipientId, setRecipientId] = useState<string | null>(recipientTeamId ?? null);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reset state when dialog opens (or pre-selection changes)
  useEffect(() => {
    if (open) {
      if (counterTo) {
        // Counter mode — user (= original recipient) becomes the new proposer.
        // Pre-fill offering/requesting as a swap of the original so the user
        // edits from a sensible baseline.
        setProposerTeamId(counterTo.recipient);
        setRecipientId(counterTo.proposer);
        setOffering(new Set(counterTo.requesting));
        setRequesting(new Set(counterTo.offering));
      } else {
        setProposerTeamId(myTeam?.id ?? null);
        setRecipientId(recipientTeamId ?? null);
        setOffering(new Set());
        setRequesting(new Set());
      }
      setSubmitError(null);
    }
  }, [open, recipientTeamId, myTeam?.id, counterTo]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const proposerTeam = (proposerTeamId ? playerMap.get(proposerTeamId) : null) ?? null;
  const recipientTeam = (recipientId ? playerMap.get(recipientId) : null) ?? null;

  // Available teams (exclude the other selected team)
  const availableProposers = useMemo(
    () => players.filter(p => p.id !== recipientId),
    [players, recipientId],
  );
  const availableRecipients = useMemo(
    () => players.filter(p => p.id !== proposerTeamId),
    [players, proposerTeamId],
  );

  // Live validation (non-blocking until user actually has selections on both sides)
  const validationIssues = useMemo(() => {
    if (!proposerTeam || !recipientTeam) return [];
    return validateTrade({
      proposer: proposerTeam,
      recipient: recipientTeam,
      offering, requesting, pointCap,
    });
  }, [proposerTeam, recipientTeam, offering, requesting, pointCap]);

  const isLegal = validationIssues.length === 0;
  const hasSelections = !!proposerTeamId && !!recipientId && offering.size > 0 && requesting.size > 0;
  const canSubmit = hasSelections && isLegal && !submitting;

  async function handleSubmit() {
    if (!proposerTeamId || !recipientId || offering.size === 0 || requesting.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (counterTo) {
        // Counter the original. Backend closes the original and creates a
        // new linked trade in the reverse direction.
        await api.counterTrade(counterTo.id, {
          offering: [...offering],
          requesting: [...requesting],
        });
        toast.success('Counter-proposal sent!');
      } else {
        await api.proposeTrade(league.id, {
          recipientId,
          offering: [...offering],
          requesting: [...requesting],
          proposerId: proposerTeamId,
        });
        toast.success('Trade proposal sent!');
      }
      onClose();
    } catch (err: any) {
      const msg = err?.message || 'Failed to send proposal';
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function togglePokemon(name: string, set: Set<string>, setFn: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFn(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-neon" />
            {counterTo ? 'Counter Trade' : 'Propose Trade'}
          </DialogTitle>
          <DialogDescription>
            {counterTo
              ? 'Edit the suggested swap and submit your counter. The original proposal will be closed.'
              : 'Select Pokemon to offer and request. The proposal will need admin approval.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Team selectors row */}
          <div className="grid grid-cols-2 gap-4">
            {/* Proposer (your team) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Your Team</label>
              <Select
                value={proposerTeamId ?? ''}
                onValueChange={v => { setProposerTeamId(v); setOffering(new Set()); }}
              >
                <SelectTrigger className="h-8 text-xs bg-surface-overlay">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProposers.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                        {p.teamAbbrev} — {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipient */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Trade Partner</label>
              <Select
                value={recipientId ?? ''}
                onValueChange={v => { setRecipientId(v); setRequesting(new Set()); }}
              >
                <SelectTrigger className="h-8 text-xs bg-surface-overlay">
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {availableRecipients.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                        {p.teamAbbrev} — {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Roster grids */}
          <div className="grid grid-cols-2 gap-4">
            {/* Offering (your roster) */}
            <RosterPicker
              label="Offering"
              labelColor="text-loss"
              team={proposerTeam}
              selected={offering}
              onToggle={name => togglePokemon(name, offering, setOffering)}
            />

            {/* Requesting (their roster) */}
            <RosterPicker
              label="Requesting"
              labelColor="text-win"
              team={recipientTeam}
              selected={requesting}
              onToggle={name => togglePokemon(name, requesting, setRequesting)}
            />
          </div>

          {/* Summary */}
          {(offering.size > 0 || requesting.size > 0) && (
            <div className="rounded-md border border-border-subtle bg-surface-overlay/30 p-3">
              <div className="flex items-center justify-center gap-3 text-xs">
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {[...offering].map(name => (
                    <Badge key={name} variant="outline" className="text-loss border-loss/30 text-[10px] gap-1 px-1.5">
                      <PokemonSprite name={name} size="xs" />
                      {name}
                    </Badge>
                  ))}
                  {offering.size === 0 && <span className="text-text-muted">Select Pokemon to offer</span>}
                </div>
                <ArrowRightLeft size={14} className="text-text-muted shrink-0" />
                <div className="flex items-center gap-1 flex-wrap">
                  {[...requesting].map(name => (
                    <Badge key={name} variant="outline" className="text-win border-win/30 text-[10px] gap-1 px-1.5">
                      <PokemonSprite name={name} size="xs" />
                      {name}
                    </Badge>
                  ))}
                  {requesting.size === 0 && <span className="text-text-muted">Select Pokemon to request</span>}
                </div>
              </div>
            </div>
          )}

          {/* Inline validation feedback */}
          {hasSelections && !isLegal && (
            <div className="rounded-md border border-loss/30 bg-loss/10 p-2.5 space-y-1">
              {validationIssues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-loss">
                  <AlertCircle size={12} className="shrink-0 mt-0.5" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}

          {submitError && (
            <div className="rounded-md border border-loss/30 bg-loss/10 p-2.5">
              <div className="flex items-start gap-2 text-[11px] text-loss">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!canSubmit}
            className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-30 gap-1.5"
            onClick={handleSubmit}
          >
            <Send size={14} />
            {submitting ? 'Sending...' : 'Send Proposal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Selectable roster grid for one team. Shows full sprite + name + tier. */
function RosterPicker({ label, labelColor, team, selected, onToggle }: {
  label: string;
  labelColor: string;
  team: Player | null;
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (!team) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-xs text-text-muted">
        Select a team to see roster
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
        <span className="text-xs font-medium text-text-primary">{team.teamAbbrev}</span>
        <span className={cn('text-[10px] font-mono uppercase tracking-wider', labelColor)}>{label}</span>
        {selected.size > 0 && (
          <Badge variant="outline" className={cn('text-[10px] ml-auto', labelColor)}>
            {selected.size}
          </Badge>
        )}
      </div>
      <div className="rounded-md border border-border-subtle max-h-[240px] overflow-y-auto">
        {team.roster.length === 0 && (
          <div className="px-3 py-4 text-center text-[10px] text-text-muted">No Pokemon on roster</div>
        )}
        {team.roster.map(mon => {
          const isSelected = selected.has(mon.name);
          return (
            <button
              key={mon.name}
              onClick={() => onToggle(mon.name)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors',
                'hover:bg-surface-overlay/40',
                isSelected && 'bg-neon/5',
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                isSelected ? 'bg-neon border-neon text-surface-base' : 'border-border-subtle',
              )}>
                {isSelected && <Check size={10} />}
              </div>
              <PokemonSprite name={mon.name} size="xs" />
              <span className="text-[11px] text-text-primary flex-1 min-w-0 truncate">{mon.name}</span>
              {isMegaForm(mon.name) && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 text-purple-400 border-purple-400/30">M</Badge>
              )}
              <TierBadge points={mon.tier} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
