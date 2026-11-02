/** Match picker for match-tied awards: lists the matches in which the chosen Pokemon appeared for the team. */
import { useEffect, useState } from 'react';
import { api, type ApiPokemonMatch } from '@/lib/api';
import { cn } from '@/lib/utils';

export function MatchPicker({
  teamId, pokemon, value, onChange,
}: {
  teamId: string;
  pokemon?: string;
  value?: string;
  onChange: (matchId: string | undefined) => void;
}) {
  const [matches, setMatches] = useState<ApiPokemonMatch[] | null>(null);
  useEffect(() => {
    setMatches(null);
    if (!pokemon) return;
    let cancelled = false;
    api.getPokemonMatches(teamId, pokemon).then(m => { if (!cancelled) setMatches(m); })
      .catch(() => { if (!cancelled) setMatches([]); });
    return () => { cancelled = true; };
  }, [teamId, pokemon]);

  const empty = !!pokemon && matches?.length === 0;
  return (
    <select
      value={value ?? ''}
      disabled={!pokemon || matches == null}
      onChange={e => onChange(e.target.value || undefined)}
      title={empty ? 'No recorded appearances for this Pokemon' : undefined}
      className={cn(
        'h-7 min-w-[9rem] max-w-[14rem] rounded-md border bg-surface-raised px-1.5 text-xs',
        pokemon && !value ? 'border-loss' : 'border-border-default',
      )}
    >
      <option value="">{!pokemon ? 'Pick Pokemon first' : empty ? 'No matches found' : 'Pick match'}</option>
      {/* A saved match stays visible even before the list loads. */}
      {value && !matches?.some(m => m.id === value) && <option value={value}>Saved match</option>}
      {matches?.map(m => (
        <option key={m.id} value={m.id}>
          {`Wk ${m.week} vs ${m.opponent}${m.score ? ` (${m.score})` : ''} - ${m.kills}K/${m.deaths}D`}
        </option>
      ))}
    </select>
  );
}
