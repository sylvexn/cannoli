import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useLeague } from '@/lib/league-context';
import type { Player } from '@/lib/types';
import { Check, Tag } from 'lucide-react';

export interface ListOnBlockDialogProps {
  open: boolean;
  onClose: () => void;
  team: Player;
  /** Names already on the block for this team (disabled in the picker). */
  alreadyListed: Set<string>;
  /** Parent reloads listings after a successful list. */
  onListed: () => void;
}

export function ListOnBlockDialog({
  open, onClose, team, alreadyListed, onListed,
}: ListOnBlockDialogProps) {
  const league = useLeague();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSelected(null);
    setNote('');
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      onClose();
    }
  }

  async function handleSubmit() {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await api.createTradeBlockListing(league.id, {
        pokemonName: selected,
        note: note.trim() || undefined,
      });
      toast.success(`Listed ${selected}`);
      onListed();
      reset();
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag size={16} className="text-neon" />
            List a Pokémon on the block
          </DialogTitle>
          <DialogDescription>
            Put one of your Pokémon up for trade. Other coaches can browse it and send you an offer.
          </DialogDescription>
        </DialogHeader>

        {/* Selectable roster list */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle divide-y divide-border-subtle/40">
          {team.roster.map(mon => {
            const isListed = alreadyListed.has(mon.name);
            const isSelected = selected === mon.name;
            return (
              <button
                key={mon.name}
                type="button"
                disabled={isListed}
                onClick={() => setSelected(isSelected ? null : mon.name)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
                  isListed && 'opacity-40 cursor-not-allowed',
                  !isListed && (isSelected
                    ? 'bg-neon/5'
                    : 'hover:bg-surface-overlay/40'),
                )}
              >
                <PokemonSprite name={mon.name} size="xs" />
                <span className="flex-1 min-w-0 text-sm font-mono text-text-primary truncate">
                  {mon.name}
                </span>
                {isListed && (
                  <span className="text-[11px] text-text-muted shrink-0">listed</span>
                )}
                <TierBadge points={mon.tier} />
                <span className="w-4 shrink-0 flex justify-center">
                  {isSelected && <Check size={14} className="text-neon" />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Optional note */}
        <Input
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={120}
          placeholder="Optional note — e.g. 'open to offers, want a wall'"
          className="text-xs"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected || submitting}
            onClick={handleSubmit}
            className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-30 gap-1.5"
          >
            <Tag size={14} />
            List it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
