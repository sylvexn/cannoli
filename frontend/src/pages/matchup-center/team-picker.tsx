import { leagues } from '@/mocks/leagues';
import type { RosterPokemon } from '@/lib/types';
import type { TeamSource } from './use-matchup-state';
import {
  Select, SelectContent, SelectItem, SelectGroup, SelectLabel,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface TeamPickerProps {
  source: TeamSource | null;
  onSelect: (roster: RosterPokemon[], source: TeamSource) => void;
  side: 'a' | 'b';
}

export function TeamPicker({ source, onSelect, side }: TeamPickerProps) {
  const currentValue = source ? `${source.leagueId}:${source.teamId}` : '';

  return (
    <Select
      value={currentValue}
      onValueChange={(val) => {
        if (!val) return;
        const [leagueId, teamId] = val.split(':');
        const league = leagues.find(l => l.id === leagueId);
        const player = league?.players.find(p => p.id === teamId);
        if (league && player) {
          onSelect(player.roster, {
            type: 'league',
            leagueId,
            teamId,
            label: `${player.teamName} (${league.name.replace(' League', '')})`,
          });
        }
      }}
    >
      <SelectTrigger
        className={`w-full ${side === 'a' ? 'border-[#3b82f6]/30' : 'border-[#ef4444]/30'}`}
      >
        <SelectValue placeholder={side === 'a' ? 'Select your team...' : 'Select opponent...'} />
      </SelectTrigger>
      <SelectContent>
        {leagues.map(league => (
          <SelectGroup key={league.id}>
            <SelectLabel>
              <span style={{ color: league.color }}>{league.name}</span>
            </SelectLabel>
            {league.players.length > 0 ? (
              league.players.map(player => (
                <SelectItem
                  key={`${league.id}:${player.id}`}
                  value={`${league.id}:${player.id}`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: player.teamColor }}
                    />
                    <span>{player.teamName}</span>
                    <span className="text-text-muted text-xs">
                      ({player.record.wins}-{player.record.losses})
                    </span>
                  </span>
                </SelectItem>
              ))
            ) : (
              <SelectItem value={`${league.id}:none`} disabled>
                No teams yet
              </SelectItem>
            )}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
