import { useState, useEffect } from 'react';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam } from '@/lib/api';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import type { TeamSource } from './use-matchup-state';
import { CustomTeamBuilder } from './custom-team-builder';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface TeamPickerProps {
  source: TeamSource | null;
  onSelect: (roster: RosterPokemon[], source: TeamSource) => void;
  side: 'a' | 'b';
}

export function TeamPicker({ source, onSelect, side }: TeamPickerProps) {
  const { leagues } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    if (leagues.length === 0) return;
    Promise.all(
      leagues.map(l => api.getTeams(l.id).then(teams => [l.id, teams] as const))
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
    });
  }, [leagues]);

  const selectValue = source?.type === 'custom' ? '__custom__'
    : source ? `${source.leagueId}:${source.teamId}` : '';

  if (showCustom) {
    return (
      <CustomTeamBuilder
        side={side}
        onImport={(roster, src) => {
          onSelect(roster, src);
          setShowCustom(false);
        }}
        onClose={() => setShowCustom(false)}
      />
    );
  }

  const borderColor = side === 'a' ? '#3b82f6' : '#ef4444';

  function handleValueChange(val: string) {
    if (!val) return;
    if (val === '__custom__') {
      setShowCustom(true);
      return;
    }
    const [leagueId, teamId] = val.split(':');
    const league = leagues.find(l => l.id === leagueId);
    const teams = teamsPerLeague[leagueId] || [];
    const team = teams.find(t => t.id === teamId);
    if (league && team) {
      const roster: RosterPokemon[] = team.roster.map(r => ({
        name: r.name,
        types: r.types as PokemonType[],
        tier: r.tier,
        isTeraCaptain: r.isTeraCaptain,
        teraTypes: r.teraTypes as PokemonType[] | undefined,
        stats: r.stats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        abilities: r.abilities,
        seasonStats: r.seasonStats,
      }));
      onSelect(roster, {
        type: 'league',
        leagueId,
        teamId,
        label: `${team.teamName} (${league.name.replace(' League', '')})`,
      });
    }
  }

  return (
    <Select value={selectValue} onValueChange={handleValueChange}>
      <SelectTrigger
        className="w-full"
        style={{ borderColor: `color-mix(in srgb, ${borderColor} 30%, transparent)` }}
      >
        <SelectValue
          placeholder={side === 'a' ? 'Select your team...' : 'Select opponent...'}
        />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value="__custom__">Custom Team...</SelectItem>
        <SelectSeparator />
        {leagues.map(league => {
          const teams = teamsPerLeague[league.id] || [];
          return (
            <SelectGroup key={league.id}>
              <SelectLabel>{league.name}</SelectLabel>
              {teams.length > 0 ? (
                teams.map(team => (
                  <SelectItem
                    key={`${league.id}:${team.id}`}
                    value={`${league.id}:${team.id}`}
                  >
                    {team.teamName} ({team.record.wins}-{team.record.losses})
                  </SelectItem>
                ))
              ) : (
                <SelectItem value={`${league.id}:__loading__`} disabled>
                  Loading...
                </SelectItem>
              )}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}
