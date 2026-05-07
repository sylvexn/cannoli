import { useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry } from '@/data/tier-list';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TYPE_COLORS } from '@/lib/constants';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDefensiveMatchups, groupMatchups } from '@/lib/type-effectiveness';
import { Swords, ArrowLeft, Shield } from 'lucide-react';
import { LeagueHistory } from './league-history';
import type { PokemonType } from '@/lib/pokemon';

export function PokemonDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const decodedName = name ? decodeURIComponent(name) : '';

  function handleBack() {
    // If we have a real history stack, go back. Otherwise, fall back to the
    // tier list (the closest "browse all Pokemon" surface).
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/tiers');
    }
  }

  const pokeData = decodedName ? getPokemonData(decodedName) : undefined;
  const tierEntry = decodedName ? getTierEntry(decodedName) : undefined;

  if (!pokeData || !decodedName) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-text-muted text-sm">Pokemon not found: {decodedName || '(empty)'}</p>
        <Link to="/" className="text-neon text-sm hover:underline flex items-center gap-1">
          <ArrowLeft size={14} /> Back to overview
        </Link>
      </div>
    );
  }

  const types = pokeData.types;
  const stats = pokeData.stats;
  const abilities = pokeData.abilities ?? [];
  const bst = stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back link */}
      <button onClick={handleBack} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-neon transition-colors">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Page title */}
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">Pokemon</span>{' '}
          <span className="text-text-primary">{decodedName}</span>
        </h1>
      </div>

      {/* Hero card */}
      <Card className="bg-surface-raised border-border-default overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            {/* Sprite */}
            <div className="shrink-0 rounded-lg bg-surface-overlay/50 p-4">
              <PokemonSprite name={decodedName} size="xl" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <TypeChip types={types} size="sm" />
                {tierEntry && <TierBadge points={tierEntry.tier} />}
                <span className="text-sm font-mono text-text-muted">BST {bst}</span>
              </div>

              {tierEntry && (
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs border-border-subtle text-text-muted font-mono">
                    Cost: {tierEntry.tier}pt
                  </Badge>
                  {tierEntry.teraCost !== tierEntry.tier && (
                    <Badge variant="outline" className="text-xs border-pink/30 text-pink font-mono">
                      Tera cost: {tierEntry.teraCost}pt
                    </Badge>
                  )}
                  {tierEntry.teraBanned && (
                    <Badge variant="outline" className="text-xs border-loss/30 text-loss">
                      Tera banned
                    </Badge>
                  )}
                </div>
              )}

              {/* Abilities */}
              {abilities.length > 0 && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
                    Abilities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {abilities.map(a => (
                      <AbilityChip key={a} name={a} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two columns: Stats + Defensive */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Base Stats */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
              <Swords size={14} className="text-neon" />
              Base Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <StatBar label="HP" value={stats.hp} />
            <StatBar label="Atk" value={stats.atk} />
            <StatBar label="Def" value={stats.def} />
            <StatBar label="SpA" value={stats.spa} />
            <StatBar label="SpD" value={stats.spd} />
            <StatBar label="Spe" value={stats.spe} />
            <div className="text-right text-xs font-mono text-text-muted pt-1">
              Total: {bst}
            </div>
          </CardContent>
        </Card>

        {/* Defensive Profile */}
        <DefensiveMatchups types={types} />
      </div>

      {/* League History */}
      <LeagueHistory pokemonName={decodedName} />
    </div>
  );
}

const multLabels: { key: string; label: string; color: string }[] = [
  { key: 'x4', label: '4x weak', color: '#f87171' },
  { key: 'x2', label: '2x weak', color: '#fb923c' },
  { key: 'x05', label: '2x resist', color: '#4ade80' },
  { key: 'x025', label: '4x resist', color: '#22d3ee' },
  { key: 'x0', label: 'Immune', color: '#a78bfa' },
];

function DefensiveMatchups({ types }: { types: PokemonType[] }) {
  const groups = useMemo(() => {
    const matchups = getDefensiveMatchups(types);
    return groupMatchups(matchups);
  }, [types.join(',')]);

  const visibleTiers = multLabels.filter(
    t => (groups as Record<string, { type: PokemonType }[]>)[t.key].length > 0,
  );

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <Shield size={14} className="text-pink" />
          Defensive Matchups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleTiers.map(tier => {
          const entries = (groups as Record<string, { type: PokemonType }[]>)[tier.key];
          return (
            <div key={tier.key}>
              <div className="text-xs font-bold mb-1.5" style={{ color: tier.color }}>
                {tier.label}
              </div>
              <div className="flex flex-wrap gap-1">
                {entries.map(({ type }) => (
                  <span
                    key={type}
                    className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded text-white"
                    style={{ backgroundColor: TYPE_COLORS[type] }}
                  >
                    {type}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
