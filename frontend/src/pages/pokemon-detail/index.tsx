import { useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAppData } from '@/lib/app-data-context';
import { getPokemonData } from '@/data/pokemon-data';
import { getTierEntry } from '@/data/tier-list';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TYPE_COLORS } from '@/lib/constants';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLink } from '@/components/team-link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDefensiveMatchups, groupMatchups } from '@/lib/type-effectiveness';
import { Swords, ArrowLeft, Shield, Gauge, UsersRound } from 'lucide-react';
import { ScoutingContext } from './scouting-context';
import type { League, Player } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';

export function PokemonDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const decodedName = name ? decodeURIComponent(name) : '';

  function handleBack() {
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
    <div className="space-y-5 max-w-6xl">
      {/* Back link */}
      <button
        onClick={handleBack}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-neon transition-colors"
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* Page title */}
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">Pokemon</span>{' '}
          <span className="text-text-primary">{decodedName}</span>
        </h1>
      </div>

      {/* Top: 2-column scouting layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Identity (~40%) */}
        <div className="lg:col-span-5">
          <IdentityCard
            decodedName={decodedName}
            types={types}
            bst={bst}
            tierEntry={tierEntry}
            abilities={abilities}
          />
        </div>

        {/* RIGHT: Stats + Matchups + Speed strip (~60%) */}
        <div className="lg:col-span-7 space-y-4">
          <BaseStatsCard stats={stats} bst={bst} />
          <DefensiveMatchupsCard types={types} />
          <SpeedTierStrip baseSpeed={stats.spe} />
        </div>
      </div>

      {/* Bottom: full-width scouting context strip */}
      <ScoutingContext pokemonName={decodedName} />
    </div>
  );
}

/* -------------------- Identity column -------------------- */

interface IdentityCardProps {
  decodedName: string;
  types: PokemonType[];
  bst: number;
  tierEntry: ReturnType<typeof getTierEntry>;
  abilities: string[];
}

function IdentityCard({ decodedName, types, bst, tierEntry, abilities }: IdentityCardProps) {
  return (
    <Card className="bg-surface-raised border-border-default h-full">
      <CardContent className="p-4 space-y-4">
        {/* Sprite */}
        <div className="rounded-lg bg-surface-overlay/50 p-4 flex items-center justify-center">
          <PokemonSprite name={decodedName} size="xl" />
        </div>

        {/* Types + cost + BST */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeChip types={types} size="sm" />
            {tierEntry && <TierBadge points={tierEntry.tier} />}
            <span className="text-xs font-mono text-text-muted">BST {bst}</span>
          </div>

          {tierEntry && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="outline" className="text-[10px] border-border-subtle text-text-muted font-mono">
                Cost: {tierEntry.tier}pt
              </Badge>
              {tierEntry.teraCost !== tierEntry.tier && (
                <Badge variant="outline" className="text-[10px] border-pink/30 text-pink font-mono">
                  Tera cost: {tierEntry.teraCost}pt
                </Badge>
              )}
              {tierEntry.teraBanned && (
                <Badge variant="outline" className="text-[10px] border-loss/30 text-loss">
                  Tera banned
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Abilities */}
        {abilities.length > 0 && (
          <div>
            <h3 className="text-[10px] font-heading font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Abilities
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {abilities.map(a => (
                <AbilityChip key={a} name={a} />
              ))}
            </div>
          </div>
        )}

        {/* Current ownership */}
        <CurrentOwnerSummary pokemonName={decodedName} />
      </CardContent>
    </Card>
  );
}

interface OwnershipEntry {
  league: League;
  player: Player;
}

function CurrentOwnerSummary({ pokemonName }: { pokemonName: string }) {
  const { leagues } = useAppData();

  const owners = useMemo<OwnershipEntry[]>(() => {
    const results: OwnershipEntry[] = [];
    for (const league of leagues) {
      if (!league.hasData) continue;
      for (const player of league.players) {
        if (player.roster.some(m => m.name === pokemonName)) {
          results.push({ league, player });
        }
      }
    }
    return results;
  }, [leagues, pokemonName]);

  return (
    <div>
      <h3 className="text-[10px] font-heading font-semibold text-text-secondary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <UsersRound size={11} className="text-neon" />
        On The Block
      </h3>
      {owners.length === 0 ? (
        <p className="text-xs text-text-muted">
          Free agent across all active leagues.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {owners.map(({ league, player }) => (
            <div
              key={`${league.id}-${player.id}`}
              className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-overlay/40 px-2 py-1.5"
            >
              <Badge
                variant="outline"
                className="text-[10px] font-bold uppercase shrink-0"
                style={{ borderColor: `${league.color}50`, color: league.color }}
              >
                {league.name.replace(' League', '')}
              </Badge>
              <TeamLink
                team={{
                  leagueId: league.id,
                  teamId: player.id,
                  teamName: player.teamName,
                  teamAbbrev: player.teamAbbrev,
                  teamColor: player.teamColor,
                  record: player.record,
                }}
                logoSize="sm"
              >
                <span className="text-xs font-medium text-text-primary hover:text-neon transition-colors truncate">
                  {player.teamName}
                </span>
              </TeamLink>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------- Right column cards -------------------- */

function BaseStatsCard({ stats, bst }: { stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }; bst: number }) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          <Swords size={14} className="text-neon" />
          Base Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-1.5">
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
  );
}

const multLabels: { key: string; label: string; color: string }[] = [
  { key: 'x4', label: '4x weak', color: '#f87171' },
  { key: 'x2', label: '2x weak', color: '#fb923c' },
  { key: 'x05', label: '2x resist', color: '#4ade80' },
  { key: 'x025', label: '4x resist', color: '#22d3ee' },
  { key: 'x0', label: 'Immune', color: '#a78bfa' },
];

function DefensiveMatchupsCard({ types }: { types: PokemonType[] }) {
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
      <CardContent className="p-4 pt-0 space-y-3">
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

/* -------------------- Speed tier band strip -------------------- */

interface SpeedBand {
  label: string;
  color: string;
}

function classifySpeed(base: number): SpeedBand {
  if (base >= 121) return { label: 'Blistering', color: '#22d3ee' };
  if (base >= 101) return { label: 'Fast',       color: '#4ade80' };
  if (base >= 81)  return { label: 'Mid',        color: '#fbbf24' };
  if (base >= 61)  return { label: 'Slow',       color: '#fb923c' };
  return            { label: 'Lethargic',   color: '#f87171' };
}

function SpeedTierStrip({ baseSpeed }: { baseSpeed: number }) {
  const band = classifySpeed(baseSpeed);
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardContent className="p-3 flex items-center gap-3">
        <div
          className="shrink-0 rounded-md px-2 py-1.5 flex items-center gap-1.5"
          style={{ backgroundColor: `${band.color}1f`, border: `1px solid ${band.color}55` }}
        >
          <Gauge size={14} style={{ color: band.color }} />
          <span className="text-[10px] font-mono uppercase tracking-wider font-bold" style={{ color: band.color }}>
            {band.label}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-heading font-semibold text-text-primary uppercase tracking-wider">
              Speed Tier
            </span>
            <span className="text-xs font-mono text-text-muted">
              base {baseSpeed}
            </span>
          </div>
        </div>
        <Link
          to="/speed-tiers"
          className="text-[11px] font-mono uppercase tracking-wider text-neon hover:underline shrink-0"
        >
          Speed tiers →
        </Link>
      </CardContent>
    </Card>
  );
}
