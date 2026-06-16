import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getTierList, getTeraBanned, canBeTeraCaptain,
  DEFAULT_FORMAT, type CostFormat, type TierEntry,
} from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { useAppData } from '@/lib/app-data-context';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { EmptyState } from '@/components/empty-state';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { Search, X, Star, ShieldOff, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { tierColor, TIER_COLORS } from '@/lib/constants';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { PokemonType } from '@/lib/pokemon';

const FORMAT_LABELS: Record<CostFormat, string> = {
  natdexplus: 'NatDex+',
  natdex: 'NatDex',
};

const FORMAT_DESCRIPTIONS: Record<CostFormat, string> = {
  natdexplus: 'Ruby/Sapphire — full NatDex+ ruleset',
  natdex: 'Emerald — legendaries/paradoxes/mythicals banned, megas/pseudos +1pt',
};

type FilterMode = 'all' | 'captains' | 'tera-banned';

export function TierListPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [format, setFormat] = useState<CostFormat>(DEFAULT_FORMAT);
  const { leagues } = useAppData();

  // Build a single ownership index across every active league: pokemon name →
  // [{leagueId, leagueColor, teamAbbrev}]. Avoids 1-fetch-per-card; the
  // app-data context already loads roster info for the active leagues.
  const ownershipIndex = useMemo(() => {
    const map = new Map<string, { leagueId: string; leagueName: string; leagueColor: string; teamAbbrev: string; teamColor: string; teamId: string }[]>();
    for (const league of leagues) {
      if (!league.hasData) continue;
      for (const player of league.players) {
        for (const mon of player.roster) {
          const list = map.get(mon.name) ?? [];
          list.push({
            leagueId: league.id,
            leagueName: league.name,
            leagueColor: league.color,
            teamAbbrev: player.teamAbbrev,
            teamColor: player.teamColor,
            teamId: player.id,
          });
          map.set(mon.name, list);
        }
      }
    }
    return map;
  }, [leagues]);

  const filtered: TierEntry[] = useMemo(() => {
    let list = getTierList(format);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q));
    }
    if (filter === 'captains') {
      list = list.filter(e => canBeTeraCaptain(e.name, format));
    } else if (filter === 'tera-banned') {
      list = list.filter(e => e.teraBanned);
    }
    return list;
  }, [search, filter, format]);

  // Group by tier, descending. Each tier is rendered as a banner+grid section.
  const byTier = useMemo(() => {
    const map = new Map<number, TierEntry[]>();
    for (const e of filtered) {
      const arr = map.get(e.tier) ?? [];
      arr.push(e);
      map.set(e.tier, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const tierList = getTierList(format);
  const totalCount = tierList.length;
  const captainCount = tierList.filter(e => canBeTeraCaptain(e.name, format)).length;
  const banCount = getTeraBanned(format).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-purple-400">Tier</span>{' '}
          <span className="text-text-primary">List</span>
        </h1>
        <p className="text-sm text-text-muted">
          Browse the full draft pool by tier. {totalCount} Pokemon · {captainCount} captain-eligible · {banCount} tera-banned.
        </p>
      </div>

      {/* Format toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono uppercase tracking-wider text-text-muted shrink-0">Format</span>
        <div className="flex items-center gap-px rounded border border-border-subtle overflow-hidden">
          {(['natdexplus', 'natdex'] as CostFormat[]).map(f => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={cn(
                'px-3 py-1 text-xs font-medium transition-colors',
                format === f
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
              )}
            >
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-text-muted">
          {FORMAT_DESCRIPTIONS[format]}
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search Pokemon by name..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-surface text-sm border border-border-subtle focus:border-neon/40 focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-md border border-border-subtle overflow-hidden">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} icon={<Filter size={11} />}>
            All
          </FilterButton>
          <FilterButton active={filter === 'captains'} onClick={() => setFilter('captains')} icon={<Star size={11} className="text-yellow-400" />}>
            Captain-eligible
          </FilterButton>
          <FilterButton active={filter === 'tera-banned'} onClick={() => setFilter('tera-banned')} icon={<ShieldOff size={11} className="text-loss" />}>
            Tera-banned
          </FilterButton>
        </div>

        <span className="ml-auto text-[11px] text-text-muted font-mono">
          {filtered.length} / {totalCount} shown
        </span>
      </div>

      {/* Tier sections */}
      <div className="space-y-4">
        {byTier.map(([tier, entries]) => (
          <TierSection
            key={tier}
            tier={tier}
            entries={entries}
            ownershipIndex={ownershipIndex}
            format={format}
          />
        ))}
        {byTier.length === 0 && (
          <Card className="bg-surface-raised border-border-default">
            <EmptyState
              variant="nothing-here"
              title="No Pokemon match these filters."
              spriteSize="md"
              padding="sm"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

interface OwnershipEntry {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  teamAbbrev: string;
  teamColor: string;
  teamId: string;
}

interface TierSectionProps {
  tier: number;
  entries: TierEntry[];
  ownershipIndex: Map<string, OwnershipEntry[]>;
  format: CostFormat;
}

function TierSection({ tier, entries, ownershipIndex, format }: TierSectionProps) {
  const accent = tierColor(tier);
  const captainEligible = entries.filter(e => canBeTeraCaptain(e.name, format)).length;
  const teraBanned = entries.filter(e => e.teraBanned).length;
  const owned = entries.filter(e => (ownershipIndex.get(e.name)?.length ?? 0) > 0).length;

  // Visual identity hints — distinguish low/mid/high bands at a glance.
  const tierLabel = tier >= 18 ? 'Apex' : tier >= 15 ? 'Premium' : tier >= 12 ? 'High' : tier >= 8 ? 'Mid' : tier >= 5 ? 'Low' : 'Budget';

  return (
    <Card className="bg-surface-raised border-border-default overflow-hidden">
      {/* Tier banner — accent gradient, big tier numeral, supporting metadata */}
      <div
        className="relative px-4 py-2.5 border-b border-border-subtle flex items-center gap-3"
        style={{
          background:
            `linear-gradient(90deg, ${accent}28 0%, ${accent}10 30%, transparent 80%),` +
            `linear-gradient(180deg, transparent 0%, ${accent}05 100%)`,
        }}
      >
        {/* Tier numeral */}
        <div
          className="flex flex-col items-center justify-center shrink-0 rounded-md border-2 px-3 py-1 leading-none font-mono font-black"
          style={{
            backgroundColor: `${accent}1a`,
            borderColor: `${accent}80`,
            color: accent,
            boxShadow: `0 0 12px ${accent}25, inset 0 0 8px ${accent}15`,
          }}
        >
          <span className="text-[10px] uppercase tracking-widest opacity-70">Tier</span>
          <span className="text-2xl tabular-nums leading-none">{tier}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-sm font-heading font-bold uppercase tracking-wider"
              style={{ color: accent }}
            >
              {tierLabel}
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              {tier}-point cost
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-text-muted">
            <span className="tabular-nums">
              <span className="text-text-primary font-semibold">{entries.length}</span> mon
            </span>
            {captainEligible > 0 && (
              <>
                <span className="text-border-subtle">|</span>
                <span className="flex items-center gap-1">
                  <Star size={10} className="text-yellow-400" />
                  <span className="tabular-nums">{captainEligible}</span> captain
                </span>
              </>
            )}
            {teraBanned > 0 && (
              <>
                <span className="text-border-subtle">|</span>
                <span className="flex items-center gap-1">
                  <ShieldOff size={10} className="text-loss" />
                  <span className="tabular-nums">{teraBanned}</span> tera-banned
                </span>
              </>
            )}
            {owned > 0 && (
              <>
                <span className="text-border-subtle">|</span>
                <span className="tabular-nums">
                  <span className="text-neon">{owned}</span> rostered
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sprite grid */}
      <div className="p-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5">
          {entries.map(entry => (
            <TierCard
              key={entry.name}
              entry={entry}
              accent={accent}
              ownership={ownershipIndex.get(entry.name) ?? []}
              format={format}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

interface TierCardProps {
  entry: TierEntry;
  accent: string;
  ownership: OwnershipEntry[];
  format: CostFormat;
}

function TierCard({ entry, accent, ownership, format }: TierCardProps) {
  const data = getPokemonData(entry.name);
  const types = (data?.types ?? []) as PokemonType[];
  const captainEligible = canBeTeraCaptain(entry.name, format);
  const { openSideCard } = usePokemonSideCard();
  const owned = ownership.length > 0;

  return (
    <div
      className={cn(
        'relative flex items-center gap-2 px-2 py-1.5 rounded-md border bg-surface-overlay/30 transition-all group',
        'hover:bg-surface-overlay/70 hover:scale-[1.015]',
        entry.teraBanned && 'opacity-85',
      )}
      style={{
        borderColor: owned ? `${accent}40` : 'transparent',
        boxShadow: owned ? `inset 2px 0 0 ${accent}` : undefined,
      }}
    >
      {/* Sprite — opens side card. Stacks ownership as small color pips below. */}
      <button
        type="button"
        onClick={() => openSideCard(entry.name)}
        className="shrink-0 rounded bg-surface-base/40 p-0.5 hover:bg-surface-base transition-colors"
        title={`Quick view ${entry.name}`}
      >
        <PokemonSprite name={entry.name} size="sm" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <Link
            to={pokemonRoute(entry.name)}
            className="text-xs font-medium text-text-primary truncate group-hover:text-neon transition-colors hover:underline"
          >
            {entry.name}
          </Link>
          {captainEligible && (
            <Star
              size={10}
              className="text-yellow-400/80 shrink-0"
              aria-label="Captain-eligible"
            />
          )}
          {entry.teraBanned && (
            <Badge
              variant="outline"
              className="text-[8px] px-1 py-0 border-loss/30 text-loss leading-none"
              title="Cannot be designated tera captain"
            >
              NoT
            </Badge>
          )}
        </div>
        {/* Type ribbon + ownership pips */}
        <div className="mt-0.5 flex items-center gap-1 min-w-0">
          {types.length > 0 && <TypeChip types={types} size="xs" />}
          {ownership.length > 0 && (
            <div
              className="flex items-center gap-px ml-auto shrink-0"
              title={ownership
                .map(o => `${o.leagueName.replace(' League', '')}: ${o.teamAbbrev}`)
                .join(' · ')}
            >
              {ownership.slice(0, 4).map((o, i) => (
                <Link
                  key={`${o.leagueId}-${i}`}
                  to={`/league/${o.leagueId}/teams/${o.teamId}`}
                  className="inline-block w-1.5 h-1.5 rounded-full hover:scale-150 transition-transform"
                  style={{ backgroundColor: o.leagueColor }}
                  title={`${o.leagueName.replace(' League', '')} · ${o.teamAbbrev}`}
                />
              ))}
              {ownership.length > 4 && (
                <span
                  className="text-[8px] font-mono ml-0.5"
                  style={{ color: accent }}
                >
                  +{ownership.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, icon, children }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// Sanity export: ensures TIER_COLORS gets bundled even if no other consumer.
// Keeps the constant from being dead-code-stripped during early development.
export const _TIER_COLOR_KEYS = Object.keys(TIER_COLORS);
