/**
 * Validates sprite URLs using the actual toSpriteId function.
 * Run with: npx tsx --tsconfig tsconfig.json scripts/validate-sprites.ts
 */
import { toSpriteId } from '../src/lib/pokemon';

const ALL_NAMES = [
  'Mega Blastoise', 'Mega Charizard X', 'Mega Charizard Y', 'Mega Garchomp', 'Mega Gyarados', 'Mega Tyranitar',
  'Mega Aerodactyl', 'Mega Alakazam', 'Mega Mawile', 'Mega Medicham', 'Mega Scizor', 'Mega Swampert',
  'Mega Altaria', 'Mega Gardevoir', 'Mega Lopunny', 'Mega Sharpedo', 'Mega Venusaur',
  'Mega Aggron', 'Mega Gallade', 'Mega Heracross', 'Mega Pinsir', 'Mega Slowbro',
  'Mega Absol', 'Mega Camerupt', 'Mega Sableye',
  'Mega Abomasnow', 'Mega Ampharos', 'Mega Beedrill', 'Mega Houndoom', 'Mega Manectric', 'Mega Sceptile', 'Mega Steelix',
  'Mega Banette', 'Mega Glalie', 'Mega Pidgeot', 'Mega Audino',
  'Darmanitan-Galar', 'Slowking-Galar', 'Goodra-Hisui', 'Lycanroc-Dusk', 'Zoroark-Hisui',
  'Ninetales-Alola', 'Samurott-Hisui', 'Arcanine-Hisui', 'Basculegion-F', 'Basculegion-M',
  'Lilligant-Hisui', 'Weezing-Galar', 'Slowbro-Galar', 'Marowak-Alola', 'Muk-Alola',
  'Decidueye-Hisui', 'Typhlosion-Hisui', 'Avalugg-Hisui', 'Qwilfish-Hisui',
  'Electrode-Hisui', 'Raichu-Alola', 'Sandslash-Alola',
  'Ursaluna-Bloodmoon', 'Tauros-Paldea-Aqua', 'Tauros-Paldea-Blaze', 'Tauros-Paldea',
  'Rotom-Wash', 'Rotom-Heat', 'Rotom-Mow', 'Rotom-Fan', 'Rotom-Frost',
  'Basculin-Blue', 'Basculin-Red', 'Basculin-White',
  'Oricorio', 'Oricorio-Pau', 'Oricorio-Pom-Pom', 'Oricorio-Sensu',
  'Indeedee-M', 'Indeedee-F', 'Meowstic-M', 'Meowstic-F',
  'Oinkologne-F', 'Oinkologne-M',
  'Wormadam', 'Wormadam-Sandy', 'Wormadam-Trash',
  'Exeggutor-Alola', 'Golem-Alola', 'Persian-Alola', 'Raticate-Alola',
  'Dugtrio-Alola', 'Graveler-Alola', 'Geodude-Alola',
  'Stunfisk-Galar', 'Linoone-Galar', 'Mr. Mime-Galar',
  'Darumaka-Galar', 'Slowpoke-Galar', 'Zigzagoon-Galar',
  'Sneasel-Hisui', 'Voltorb-Hisui', 'Growlithe-Hisui', 'Zorua-Hisui', 'Sliggoo-Hisui',
  'Yamask-Galar', 'Ponyta-Galar', 'Meowth-Galar', 'Meowth-Alola', 'Sandshrew-Alola',
  'Kommo-o', 'Hakamo-o', 'Jangmo-o',
  'Mr. Mime', 'Mr. Rime', 'Mime Jr.',
  'Farfetchd', 'Farfetchd-Galar', "Sirfetch'd",
  'Ho-Oh', 'Porygon-Z', 'Porygon2',
  'Type: Null', 'Nidoran-F', 'Nidoran-M',
  'Baxcalibur', 'Gholdengo', 'Meowscarada', 'Kingambit', 'Archaludon',
  'Annihilape', 'Palafin', 'Ceruledge', 'Armarouge', 'Kilowattrel',
  'Bellibolt', 'Dondozo', 'Tinkaton', 'Orthworm', 'Glimmora',
  'Brambleghast', 'Espathra', 'Farigiraf', 'Klawf', 'Scovillain',
  'Squawkabilly', 'Squawkabilly-Yellow',
  'Cyclizar', 'Dipplin', 'Hydrapple', 'Appletun', 'Flapple',
  'Toedscruel', 'Clodsire', 'Garganacl',
  'Lycanroc-Midday', 'Lycanroc-Midnight',
  'Flabebe', 'Floette', 'Pumpkaboo', 'Gourgeist',
];

async function check(name: string): Promise<{ name: string; id: string; ok: boolean }> {
  const id = toSpriteId(name);
  const url = `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return { name, id, ok: res.ok };
  } catch { return { name, id, ok: false }; }
}

async function main() {
  console.log(`Checking ${ALL_NAMES.length} sprites...\n`);
  const results: { name: string; id: string; ok: boolean }[] = [];
  for (let i = 0; i < ALL_NAMES.length; i += 20) {
    const batch = ALL_NAMES.slice(i, i + 20);
    results.push(...await Promise.all(batch.map(check)));
    process.stdout.write(`  ${Math.min(i + 20, ALL_NAMES.length)}/${ALL_NAMES.length}\r`);
  }
  const fails = results.filter(r => !r.ok);
  console.log(`\n\n✓ ${results.length - fails.length} OK`);
  if (fails.length) {
    console.log(`✗ ${fails.length} MISSING:\n`);
    for (const f of fails) console.log(`  ${f.name.padEnd(28)} → ${f.id}`);
  } else {
    console.log('All sprites valid!');
  }
}
main();
