/**
 * Verify our type chart against known dual-type matchups.
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-type-chart.ts
 */

import type { PokemonType } from '../src/lib/pokemon';
import { POKEMON_TYPES } from '../src/lib/pokemon';

// Our chart (copy from team-profile.tsx)
const TYPE_CHART: Record<PokemonType, { weak: PokemonType[]; resist: PokemonType[]; immune: PokemonType[] }> = {
  normal: { weak: ['fighting'], resist: [], immune: ['ghost'] },
  fire: { weak: ['water', 'ground', 'rock'], resist: ['fire', 'grass', 'ice', 'bug', 'steel', 'fairy'], immune: [] },
  water: { weak: ['electric', 'grass'], resist: ['fire', 'water', 'ice', 'steel'], immune: [] },
  electric: { weak: ['ground'], resist: ['electric', 'flying', 'steel'], immune: [] },
  grass: { weak: ['fire', 'ice', 'poison', 'flying', 'bug'], resist: ['water', 'electric', 'grass', 'ground'], immune: [] },
  ice: { weak: ['fire', 'fighting', 'rock', 'steel'], resist: ['ice'], immune: [] },
  fighting: { weak: ['flying', 'psychic', 'fairy'], resist: ['bug', 'rock', 'dark'], immune: [] },
  poison: { weak: ['ground', 'psychic'], resist: ['fighting', 'poison', 'bug', 'grass', 'fairy'], immune: [] },
  ground: { weak: ['water', 'grass', 'ice'], resist: ['poison', 'rock'], immune: ['electric'] },
  flying: { weak: ['electric', 'ice', 'rock'], resist: ['fighting', 'bug', 'grass'], immune: ['ground'] },
  psychic: { weak: ['bug', 'ghost', 'dark'], resist: ['fighting', 'psychic'], immune: [] },
  bug: { weak: ['fire', 'flying', 'rock'], resist: ['fighting', 'ground', 'grass'], immune: [] },
  rock: { weak: ['water', 'grass', 'fighting', 'ground', 'steel'], resist: ['normal', 'fire', 'poison', 'flying'], immune: [] },
  ghost: { weak: ['ghost', 'dark'], resist: ['poison', 'bug'], immune: ['normal', 'fighting'] },
  dragon: { weak: ['ice', 'dragon', 'fairy'], resist: ['fire', 'water', 'electric', 'grass'], immune: [] },
  dark: { weak: ['fighting', 'bug', 'fairy'], resist: ['ghost', 'dark'], immune: ['psychic'] },
  steel: { weak: ['fire', 'fighting', 'ground'], resist: ['normal', 'grass', 'ice', 'flying', 'psychic', 'bug', 'rock', 'dragon', 'steel', 'fairy'], immune: ['poison'] },
  fairy: { weak: ['poison', 'steel'], resist: ['fighting', 'bug', 'dark'], immune: ['dragon'] },
};

function calcEffectiveness(atkType: PokemonType, defTypes: PokemonType[]): number {
  let mult = 1;
  for (const defType of defTypes) {
    const chart = TYPE_CHART[defType];
    if (chart.immune.includes(atkType)) mult *= 0;
    else if (chart.weak.includes(atkType)) mult *= 2;
    else if (chart.resist.includes(atkType)) mult *= 0.5;
  }
  return mult;
}

// Known test cases (attacking type → defending types → expected multiplier)
const TESTS: [PokemonType, PokemonType[], number, string][] = [
  // 4x weak
  ['ice', ['dragon', 'flying'], 4, 'Ice vs Dragonite (Dragon/Flying) = 4x'],
  ['ground', ['fire', 'rock'], 4, 'Ground vs Magcargo (Fire/Rock) = 4x'],
  ['fighting', ['rock', 'dark'], 4, 'Fighting vs Tyranitar (Rock/Dark) = 4x'],
  ['grass', ['water', 'ground'], 4, 'Grass vs Swampert (Water/Ground) = 4x'],
  ['ice', ['grass', 'ground'], 4, 'Ice vs Torterra (Grass/Ground) = 4x'],
  ['fire', ['bug', 'steel'], 4, 'Fire vs Forretress (Bug/Steel) = 4x'],

  // 0.25x resist
  ['fire', ['water', 'dragon'], 0.25, 'Fire vs Kingdra (Water/Dragon) = 0.25x'],
  ['grass', ['fire', 'flying'], 0.25, 'Grass vs Charizard (Fire/Flying) = 0.25x'],
  ['fighting', ['poison', 'fairy'], 0.25, 'Fighting vs Weezing-Galar... wait no. Let me think...'],

  // Immunities with dual type
  ['electric', ['ground', 'flying'], 0, 'Electric vs Gliscor (Ground/Flying) = 0x (Ground immune)'],
  ['ground', ['flying', 'dragon'], 0, 'Ground vs Salamence (Flying/Dragon) = 0x (Flying immune)'],
  ['fighting', ['ghost', 'dark'], 0, 'Fighting vs Sableye (Ghost/Dark) = 0x (Ghost immune to Fighting)'],
  ['normal', ['ghost', 'poison'], 0, 'Normal vs Gengar (Ghost/Poison) = 0x'],
  ['dragon', ['fairy', 'steel'], 0, 'Dragon vs Mawile (Steel/Fairy) = 0x (Fairy immune)'],

  // Immunity cancels weakness: Ghost immune to Fighting, Dark weak to Fighting = 0x
  ['fighting', ['ghost', 'dark'], 0, 'Fighting vs Spiritomb-like (Ghost/Dark) = 0x'],

  // Normal effectiveness combos
  ['water', ['fire', 'grass'], 1, 'Water vs Grass/Fire (2x fire, 0.5x grass) = 1x'],
  ['ice', ['water', 'flying'], 2, 'Ice vs Gyarados (Water resists, Flying weak) = 1x... wait'],

  // Steel resists everything
  ['psychic', ['steel', 'fairy'], 0.5, 'Psychic vs Klefki (Steel resists, Fairy neutral) = 0.5x'],
  ['dragon', ['steel', 'fairy'], 0, 'Dragon vs Mawile (Fairy immune) = 0x'],

  // Specific known mons
  ['fire', ['bug', 'grass'], 4, 'Fire vs Parasect (Bug/Grass) = 4x'],
  ['electric', ['water', 'flying'], 4, 'Electric vs Gyarados (Water/Flying) = 4x'],
  ['rock', ['fire', 'flying'], 4, 'Rock vs Charizard (Fire/Flying) = 4x'],
];

let pass = 0, fail = 0;
for (const [atk, def, expected, desc] of TESTS) {
  const result = calcEffectiveness(atk, def);
  if (result === expected) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${desc}`);
    console.log(`  Expected ${expected}x, got ${result}x`);
  }
}

// Fix test case that was wrong in my expectations
const waterVsFireGrass = calcEffectiveness('water', ['fire', 'grass']);
console.log(`\nWater vs Fire/Grass = ${waterVsFireGrass}x (SE fire, NVE grass = 1x)`);

const iceVsWaterFlying = calcEffectiveness('ice', ['water', 'flying']);
console.log(`Ice vs Water/Flying = ${iceVsWaterFlying}x (NVE water, SE flying = 1x)`);

const fightingVsPoisonFairy = calcEffectiveness('fighting', ['poison', 'fairy']);
console.log(`Fighting vs Poison/Fairy = ${fightingVsPoisonFairy}x (NVE poison, NVE fairy = 0.25x)`);

console.log(`\n${pass} passed, ${fail} failed out of ${TESTS.length} tests`);

// Verify some 4x/0.25x cases exist in our roster mons
console.log('\n--- Checking roster mons for 4x/0.25x ---');
const ROSTER_MONS: [string, PokemonType[]][] = [
  ['Mega Blastoise', ['water']],
  ['Mandibuzz', ['dark', 'flying']],
  ['Crabominable', ['fighting', 'ice']],
  ['Marowak-Alola', ['fire', 'ghost']],
  ['Gliscor', ['ground', 'flying']],
  ['Kingambit', ['dark', 'steel']],
  ['Mega Charizard Y', ['fire', 'flying']],
  ['Baxcalibur', ['dragon', 'ice']],
  ['Gholdengo', ['steel', 'ghost']],
];

for (const [name, types] of ROSTER_MONS) {
  const extremes: string[] = [];
  for (const atk of POKEMON_TYPES) {
    const mult = calcEffectiveness(atk, types);
    if (mult === 4) extremes.push(`${atk}=4x`);
    else if (mult === 0.25) extremes.push(`${atk}=0.25x`);
    else if (mult === 0) extremes.push(`${atk}=0x`);
  }
  if (extremes.length > 0) {
    console.log(`  ${name} (${types.join('/')}): ${extremes.join(', ')}`);
  }
}
