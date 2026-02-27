import { useState, useMemo } from 'react';
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
import { ArrowRightLeft, Check, Send } from 'lucide-react';
import { useLeagueData } from '@/lib/league-data-context';
import { useLeague } from '@/lib/league-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { Player } from '@/lib/types';

interface TradeProposeDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected recipient team ID (from clicking a trade block listing) */
  recipientTeamId?: string | null;
}

export function TradeProposeDialog({ open, onClose, recipientTeamId }: TradeProposeDialogProps) {
  const league = useLeague();
  const { players } = useLeagueData();
  const playerMap = useMemo(() => new Map(players.map(p => [p.id, p])), [players]);

  const [proposerTeamId, setProposerTeamId] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState<string | null>(recipientTeamId ?? null);
  const [offering, setOffering] = useState<Set<string>>(new Set());
  const [requesting, setRequesting] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
      return;
    }
    setOffering(new Set());
    setRequesting(new Set());
    setRecipientId(recipientTeamId ?? null);
    setProposerTeamId(null);
  };

  // When dialog opens with recipient pre-set, auto-fill
  useMemo(() => {
    if (open && recipientTeamId) {
      setRecipientId(recipientTeamId);
    }
  }, [open, recipientTeamId]);

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

  const canSubmit = proposerTeamId && recipientId && offering.size > 0 && requesting.size > 0 && !submitting;

  async function handleSubmit() {
    if (!proposerTeamId || !recipientId || offering.size === 0 || requesting.size === 0) return;
    setSubmitting(true);
    try {
      await api.proposeTrade(league.id, {
        recipientId,
        offering: [...offering],
        requesting: [...requesting],
        proposerId: proposerTeamId,
      });
      toast.success('Trade proposal sent!');
      onClose();
    } catch (err: any) {
      toast.error(err.message);
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
            Propose Trade
          </DialogTitle>
          <DialogDescription>
            Select Pokemon to offer and request. The proposal will need admin approval.
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

/** Selectable roster grid for one team */
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
      <div className="rounded-md border border-border-subtle max-h-[200px] overflow-y-auto">
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
              <TierBadge points={mon.tier} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
