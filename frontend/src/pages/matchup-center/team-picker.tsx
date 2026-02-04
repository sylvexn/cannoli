import { leagues } from '@/mocks/leagues';
import type { RosterPokemon } from '@/lib/types';
import type { TeamSource } from './use-matchup-state';

interface TeamPickerProps {
  source: TeamSource | null;
  onSelect: (roster: RosterPokemon[], source: TeamSource) => void;
  side: 'a' | 'b';
}

export function TeamPicker({ source, onSelect, side }: TeamPickerProps) {
  return (
    <div className="relative">
      <select
        value={source ? `${source.leagueId}:${source.teamId}` : ''}
        onChange={e => {
          const val = e.target.value;
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
        className={`w-full h-8 rounded-lg border bg-transparent px-2.5 text-sm text-text-primary outline-none cursor-pointer appearance-none
          focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50
          dark:bg-input/30 dark:hover:bg-input/50
          ${side === 'a' ? 'border-[#3b82f6]/30' : 'border-[#ef4444]/30'}`}
      >
        <option value="" disabled>
          {side === 'a' ? 'Select your team...' : 'Select opponent...'}
        </option>
        {leagues.map(league => (
          <optgroup key={league.id} label={league.name}>
            {league.players.length > 0 ? (
              league.players.map(player => (
                <option
                  key={`${league.id}:${player.id}`}
                  value={`${league.id}:${player.id}`}
                >
                  {player.teamName} ({player.record.wins}-{player.record.losses})
                </option>
              ))
            ) : (
              <option disabled>No teams yet</option>
            )}
          </optgroup>
        ))}
      </select>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
