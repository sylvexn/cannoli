import { TeamLogo } from '@/components/team-logo';
import { TierBadge } from '@/components/tier-badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRightLeft } from 'lucide-react';
import type { Player } from '@/lib/types';
import { isMegaForm } from '@/lib/draft-rules';
import { cn } from '@/lib/utils';

interface SelectStepProps {
  proposer: Player | null;
  recipient: Player | null;
  offering: Set<string>;
  requesting: Set<string>;
  toggleOffering: (name: string) => void;
  toggleRequesting: (name: string) => void;
}

/**
 * Step 3 — actually pick the Pokemon to trade. Same selection UI as the
 * quick-propose dialog but laid out for the wizard's wider canvas, with a
 * persistent live summary strip beneath the rosters.
 */
export function SelectStep({
  proposer,
  recipient,
  offering,
  requesting,
  toggleOffering,
  toggleRequesting,
}: SelectStepProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <RosterPicker
          label="Offering"
          labelColor="text-loss"
          team={proposer}
          selected={offering}
          onToggle={toggleOffering}
        />
        <RosterPicker
          label="Requesting"
          labelColor="text-win"
          team={recipient}
          selected={requesting}
          onToggle={toggleRequesting}
        />
      </div>

      {(offering.size > 0 || requesting.size > 0) && (
        <div className="rounded-md border border-border-subtle bg-surface-overlay/30 p-3">
          <div className="flex items-center justify-center gap-3 text-xs flex-wrap">
            <SelectionPills names={[...offering]} side="loss" empty="Select Pokemon to offer" />
            <ArrowRightLeft size={14} className="text-text-muted shrink-0" />
            <SelectionPills names={[...requesting]} side="win" empty="Select Pokemon to request" />
          </div>
        </div>
      )}
    </div>
  );
}

function SelectionPills({ names, side, empty }: { names: string[]; side: 'win' | 'loss'; empty: string }) {
  if (names.length === 0) return <span className="text-text-muted">{empty}</span>;
  const cls = side === 'loss' ? 'text-loss border-loss/30' : 'text-win border-win/30';
  return (
    <div className="flex items-center gap-1 flex-wrap justify-center">
      {names.map(name => (
        <Badge key={name} variant="outline" className={cn('text-[10px] gap-1 px-1.5', cls)}>
          <PokemonSprite name={name} size="xs" />
          {name}
        </Badge>
      ))}
    </div>
  );
}

function RosterPicker({
  label, labelColor, team, selected, onToggle,
}: {
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
      <div className="rounded-md border border-border-subtle max-h-[300px] overflow-y-auto">
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
