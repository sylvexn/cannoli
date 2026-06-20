import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { RosterPokemon } from '@/lib/types';
import { DEFAULT_MOVE_CATEGORIES } from '@/data/move-categories';
import { getTeamMoveCoverage } from '@/lib/move-coverage';
import { AbilityChip } from '@/components/ability-chip';
import { api } from '@/lib/api';
import { TYPE_COLORS } from '@/lib/constants';
import type { PokemonType } from '@/lib/pokemon';
import { ChevronDown } from 'lucide-react';

interface MovesTabProps {
  teamA: RosterPokemon[];
  teamB: RosterPokemon[];
}

/**
 * Best-effort move-name → Pokemon type lookup.
 * Only needs to cover the default move categories — admin-added moves fall back
 * to uncolored text, which is fine.
 */
const MOVE_TYPE_MAP: Record<string, PokemonType> = {
  // Hazards
  'Stealth Rock': 'rock', 'Spikes': 'ground', 'Toxic Spikes': 'poison',
  'Sticky Web': 'bug', 'Defog': 'flying', 'Rapid Spin': 'normal',
  // Healing
  'Wish': 'normal', 'Healing Wish': 'psychic', 'Revival Blessing': 'normal',
  'Heal Bell': 'normal', 'Aromatherapy': 'grass', 'Moonlight': 'fairy',
  'Morning Sun': 'normal', 'Recover': 'normal', 'Roost': 'flying',
  'Slack Off': 'normal', 'Soft-Boiled': 'normal', 'Strength Sap': 'grass',
  'Synthesis': 'grass',
  // Momentum
  'U-turn': 'bug', 'Volt Switch': 'electric', 'Flip Turn': 'water',
  'Parting Shot': 'dark', 'Teleport': 'psychic', 'Shed Tail': 'normal',
  // Priority
  'Accelerock': 'rock', 'Aqua Jet': 'water', 'Bullet Punch': 'steel',
  'Extreme Speed': 'normal', 'Fake Out': 'normal', 'Feint': 'normal',
  'First Impression': 'bug', 'Ice Shard': 'ice', 'Mach Punch': 'fighting',
  'Quick Attack': 'normal', 'Shadow Sneak': 'ghost', 'Sucker Punch': 'dark',
  'Vacuum Wave': 'fighting', 'Upper Hand': 'fighting', 'Water Shuriken': 'water',
  // Disruption
  'Taunt': 'dark', 'Knock Off': 'dark', 'Encore': 'normal',
  'Trick': 'psychic', 'Switcheroo': 'normal', 'Thief': 'dark',
  'Psychic Noise': 'psychic', 'Covet': 'normal', 'Corrosive Gas': 'poison',
  'Soak': 'water', 'Worry Seed': 'grass', 'Entrainment': 'normal',
  'Skill Swap': 'psychic', 'Simple Beam': 'normal', 'Imprison': 'psychic',
  // Trapping (moves)
  'Bind': 'normal', 'Block': 'normal', 'Clamp': 'water',
  'Fire Spin': 'fire', 'Mean Look': 'normal', 'Sand Tomb': 'ground',
  'Whirlpool': 'water', 'Wrap': 'normal',
  // Phasing
  'Haze': 'ice', 'Circle Throw': 'fighting', 'Dragon Tail': 'dragon',
  'Roar': 'normal', 'Clear Smog': 'poison', 'Whirlwind': 'normal',
  // HP Cutting
  'Pain Split': 'normal', 'Endeavor': 'normal', 'Super Fang': 'normal',
  'Seismic Toss': 'fighting', 'Final Gambit': 'fighting', 'Night Shade': 'ghost',
  'Psywave': 'psychic', 'Dragon Rage': 'dragon', 'Sonic Boom': 'normal',
  // Status
  'Glare': 'normal', 'Nuzzle': 'electric', 'Sleep Powder': 'grass',
  'Spore': 'grass', 'Stun Spore': 'grass', 'Thunder Wave': 'electric',
  'Toxic': 'poison', 'Will-O-Wisp': 'fire', 'Yawn': 'normal',
  // Speed Control
  'Bulldoze': 'ground', 'Electroweb': 'electric', 'Icy Wind': 'ice',
  'Quash': 'dark', 'Tailwind': 'flying', 'Trick Room': 'psychic',
  // Support
  'Reflect': 'psychic', 'Light Screen': 'psychic', 'Aurora Veil': 'ice',
  'Ally Switch': 'psychic', 'Follow Me': 'normal', 'Rage Powder': 'bug',
  'Quick Guard': 'fighting', 'Wide Guard': 'rock', 'Helping Hand': 'normal',
  'Snarl': 'dark', 'Beat Up': 'dark',
  // Weather moves
  'Sunny Day': 'fire', 'Rain Dance': 'water', 'Hail': 'ice',
  'Snowscape': 'ice', 'Sandstorm': 'rock', 'Weather Ball': 'normal',
  // Terrain moves
  'Electric Terrain': 'electric', 'Rising Voltage': 'electric',
  'Psychic Terrain': 'psychic', 'Expanding Force': 'psychic',
  'Misty Terrain': 'fairy', 'Misty Explosion': 'fairy',
  'Grassy Terrain': 'grass', 'Grassy Glide': 'grass',
  'Ice Spinner': 'ice', 'Terrain Pulse': 'normal',
  // Setup
  'Dragon Dance': 'dragon', 'Swords Dance': 'normal', 'Shell Smash': 'normal',
  'Shift Gear': 'steel', 'Belly Drum': 'normal', 'Bulk Up': 'fighting',
  'Coil': 'poison', 'Hone Claws': 'dark', 'Curse': 'ghost', 'Work Up': 'normal',
  'Calm Mind': 'psychic', 'Nasty Plot': 'dark', 'Quiver Dance': 'bug',
  'Cosmic Power': 'psychic', 'Iron Defense': 'steel', 'Cotton Guard': 'grass',
  'Acid Armor': 'poison', 'Amnesia': 'psychic', 'Agility': 'psychic',
  'Rock Polish': 'rock', 'Autotomize': 'steel', 'Body Press': 'fighting',
  'Stored Power': 'psychic', 'Power Trip': 'dark',
};

/** Return type color for a move or ability name, or undefined if unknown. */
function getMoveColor(name: string): string | undefined {
  const type = MOVE_TYPE_MAP[name];
  return type ? TYPE_COLORS[type] : undefined;
}

export function MovesTab({ teamA, teamB }: MovesTabProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [apiCategories, setApiCategories] = useState(DEFAULT_MOVE_CATEGORIES);

  useEffect(() => {
    api.getMoveCategories().then(cats => {
      if (cats.length > 0) setApiCategories(cats);
    }).catch(() => {
      // Fall back to defaults silently
    });
  }, []);

  const coverage = useMemo(
    () => getTeamMoveCoverage(teamA, teamB, apiCategories),
    [teamA, teamB, apiCategories],
  );

  function toggleCategory(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (teamA.length === 0 && teamB.length === 0) {
    return (
      <div className="rounded-lg border border-border-default p-8 text-center text-text-muted text-sm">
        Select teams to see move coverage
      </div>
    );
  }

  // Column widths: move label 160px, each pokemon ~40px min
  const colW = 'min-w-[38px] max-w-[56px] flex-1';

  return (
    <div className="border border-border-default rounded-lg w-full overflow-x-auto">
      {/* ── Sticky sprite header ───────────────────────────── */}
      <div className="sticky top-0 z-10 flex items-center border-b border-border-default bg-surface-raised rounded-t-lg min-w-max">
        {/* Label column */}
        <div className="w-40 shrink-0 px-3 py-2 text-[10px] text-text-muted font-medium uppercase tracking-wider">
          Move / Ability
        </div>

        {/* Team A sprites */}
        <div className="flex">
          {teamA.map((p, i) => (
            <div
              key={`a-${p.name}`}
              className={cn(
                colW,
                'flex justify-center py-1.5 bg-[#3b82f6]/5',
                i < teamA.length - 1 && 'border-r border-[#3b82f6]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" shiny={p.isShiny} />
              </Link>
            </div>
          ))}
        </div>

        {/* Divider between teams */}
        <div className="w-px bg-border-default shrink-0 self-stretch" />

        {/* Team B sprites */}
        <div className="flex">
          {teamB.map((p, i) => (
            <div
              key={`b-${p.name}`}
              className={cn(
                colW,
                'flex justify-center py-1.5 bg-[#ef4444]/5',
                i < teamB.length - 1 && 'border-r border-[#ef4444]/10',
              )}
            >
              <Link
                to={pokemonRoute(p.name)}
                title={p.nickname ? `${p.name} — "${p.nickname}"` : p.name}
                className="hover:scale-110 transition-transform"
              >
                <PokemonSprite name={p.name} size="sm" shiny={p.isShiny} />
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* ── Categories ────────────────────────────────────── */}
      {coverage.map(({ category, entries }) => {
        const isCollapsed = collapsed.has(category.id);
        const aCount = entries.filter(e => e.teamA.length > 0).length;
        const bCount = entries.filter(e => e.teamB.length > 0).length;

        return (
          <div key={category.id}>
            {/* Category header row */}
            <button
              onClick={() => toggleCategory(category.id)}
              className="w-full min-w-max flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/40 hover:bg-surface-overlay/60 transition-colors text-left border-b border-border-subtle/50"
            >
              <ChevronDown
                size={12}
                className={cn(
                  'text-text-muted transition-transform shrink-0',
                  isCollapsed && '-rotate-90',
                )}
              />
              <span className="text-xs font-semibold text-text-primary w-32 shrink-0">
                {category.name}
              </span>
              <span className="text-[10px] text-[#3b82f6] font-mono tabular-nums">
                {aCount}/{entries.length}
              </span>
              <span className="mx-1 text-text-muted text-[10px]">·</span>
              <span className="text-[10px] text-[#ef4444] font-mono tabular-nums">
                {bCount}/{entries.length}
              </span>
            </button>

            {/* Entry rows */}
            {!isCollapsed && entries.map(({ entry, teamA: matchesA, teamB: matchesB }, rowIdx) => {
              const typeColor = getMoveColor(entry.name);
              return (
                <div
                  key={entry.moveId}
                  className={cn(
                    'flex items-center border-b border-border-subtle/20 min-w-max',
                    rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-surface-overlay/[0.04]',
                    'hover:bg-surface-overlay/10 transition-colors',
                  )}
                >
                  {/* Move / Ability name */}
                  <div className="w-40 shrink-0 px-3 py-[5px]">
                    {entry.isAbility ? (
                      <AbilityChip name={entry.name} />
                    ) : (
                      <span
                        className="text-[11px] font-medium leading-tight"
                        title={`Move: ${entry.name}`}
                        style={typeColor ? { color: typeColor } : undefined}
                      >
                        {!typeColor && (
                          <span className="text-text-secondary">{entry.name}</span>
                        )}
                        {typeColor && entry.name}
                      </span>
                    )}
                  </div>

                  {/* Team A indicators */}
                  <div className="flex">
                    {teamA.map((p, i) => {
                      const has = matchesA.includes(p.name);
                      return (
                        <div
                          key={`a-${p.name}`}
                          className={cn(
                            colW,
                            'flex justify-center items-center py-[5px]',
                            i < teamA.length - 1 && 'border-r border-border-subtle/10',
                            has && 'bg-[#3b82f6]/[0.07]',
                          )}
                        >
                          {has ? (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-[#3b82f6] shadow-[0_0_4px_#3b82f6]"
                              title={`${p.name} has ${entry.name}`}
                            />
                          ) : (
                            <span className="inline-block w-2 h-2 rounded-full bg-surface-overlay/20" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Team divider */}
                  <div className="w-px bg-border-default/40 shrink-0 self-stretch" />

                  {/* Team B indicators */}
                  <div className="flex">
                    {teamB.map((p, i) => {
                      const has = matchesB.includes(p.name);
                      return (
                        <div
                          key={`b-${p.name}`}
                          className={cn(
                            colW,
                            'flex justify-center items-center py-[5px]',
                            i < teamB.length - 1 && 'border-r border-border-subtle/10',
                            has && 'bg-[#ef4444]/[0.07]',
                          )}
                        >
                          {has ? (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-[#ef4444] shadow-[0_0_4px_#ef4444]"
                              title={`${p.name} has ${entry.name}`}
                            />
                          ) : (
                            <span className="inline-block w-2 h-2 rounded-full bg-surface-overlay/20" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
