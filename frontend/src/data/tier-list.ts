/**
 * Full tier list — GENERATED from backend/imports/Costs.xlsx (NatDex+ sheet).
 * Do not hand-edit: re-run `bun run scripts/gen-tier-list.ts` from backend/.
 * Categories: Banned, Tera Banned, and tiers 20 → 1.
 * Tera cost schedule included for captain cost computation.
 */


export interface TierEntry {
  name: string;
  tier: number;
  /** Cost when designated as a tera captain. Same as tier for 10pt+, higher for 9pt and below. */
  teraCost: number;
  /** Whether this Pokemon is banned from being a tera captain */
  teraBanned: boolean;
}

// ─── Tera cost schedule (tiers 9 and below cost more as captains) ───
const TERA_COST_MAP: Record<number, number> = {
  9: 12, 8: 10, 7: 9, 6: 8, 5: 6, 4: 5, 3: 4, 2: 2, 1: 1,
};

export function getTermCost(baseTier: number): number {
  return TERA_COST_MAP[baseTier] ?? baseTier;
}

// ─── Banned Pokemon (not draftable) ─────────────────────────────
export const BANNED: string[] = [
  'Arceus','Arceus-Bug','Arceus-Dark','Arceus-Dragon','Arceus-Electric','Arceus-Fairy','Arceus-Fighting','Arceus-Fire','Arceus-Flying','Arceus-Ghost','Arceus-Grass','Arceus-Ground','Arceus-Ice','Arceus-Poison','Arceus-Psychic','Arceus-Rock','Arceus-Steel','Arceus-Water','Blacephalon','Buzzwole','Calyrex-Ice','Calyrex-Shadow','Celesteela','Chien-Pao','Corsola-Galar','Deoxys','Deoxys-Attack','Deoxys-Speed','Dialga','Eternatus','Flutter Mane','Genesect','Giratina','Groudon','Guzzlord','Ho-Oh','Kartana','Koraidon','Kyogre','Kyurem-Black','Kyurem-White','Lugia','Lunala','Magearna','Marshadow','Mega Blaziken','Mega Diancie','Mega Gengar','Mega Kangaskhan','Mega Latias','Mega Latios','Mega Lucario','Mega Metagross','Mega Mewtwo X','Mega Mewtwo Y','Mega Rayquaza','Mega Salamence','Melmetal','Meltan','Mewtwo','Miraidon','Naganadel','Necrozma-Dawn','Necrozma-Dusk','Necrozma-Ultra','Nihilego','Palkia','Pecharunt','Pheromosa','Poipole','Primal Groudon','Primal Kyogre','Rayquaza','Reshiram','Shaymin-Sky','Shedinja','Silvally','Smeargle','Solgaleo','Spectrier','Stakataka','Sunkern','Terapagos','Terapagos-Stellar','Terapagos-Terastal','Type: Null','Urshifu-Rapid-Strike','Urshifu-Single-Strike','Victini','Wynaut','Xerneas','Xurkitree','Yveltal','Zacian','Zacian-Crowned','Zamazenta','Zamazenta-Crowned','Zekrom','Zygarde','Zygarde-10','Zygarde-Complete',
];

// ─── Tera Banned (can be drafted, cannot be tera captain) ────────
export const TERA_BANNED: string[] = [
  'Alcremie','Articuno','Articuno-Galar','Brute Bonnet','Calyrex','Cetitan','Cosmoem','Cosmog','Diancie','Fezandipiti','Glastrier','Hoopa','Iron Thorns','Kubfu','Linoone','Mudsdale','Phione','Polteageist','Regice','Regieleki','Regigigas','Regirock','Registeel','Reuniclus','Sinistcha','Toxtricity','Virizion','Wo-Chien',
];

// ─── Full tier list (20pt → 1pt) ────────────────────────────────
const TIERS_RAW: [number, string[]][] = [
  [20, ['Mega Blastoise','Mega Charizard X','Mega Charizard Y','Mega Gyarados','Palafin']],
  [19, ['Chi-Yu','Darkrai','Iron Bundle','Iron Valiant','Landorus-Incarnate','Latios','Mega Alakazam','Mega Scizor','Mega Swampert','Mega Tyranitar','Roaring Moon']],
  [18, ['Baxcalibur','Dragapult','Garchomp','Gouging Fire','Great Tusk','Greninja','Kommo-o','Kyurem','Latias','Mega Aerodactyl','Mega Garchomp','Mega Lopunny','Ogerpon-Hearthflame','Zeraora']],
  [17, ['Archaludon','Cinderace','Corviknight','Darmanitan-Galar','Dragonite','Enamorus-Incarnate','Gholdengo','Gliscor','Iron Boulder','Kingambit','Landorus-Therian','Mega Gallade','Mega Gardevoir','Mega Mawile','Mega Medicham','Mega Sharpedo','Mega Slowbro','Meowscarada','Slowbro','Slowking','Slowking-Galar','Tornadus-Therian']],
  [16, ['Annihilape','Blaziken','Clefable','Ferrothorn','Iron Treads','Manaphy','Mega Absol','Mega Altaria','Mew','Rillaboom','Scizor','Sneasler','Tapu Fini','Tapu Koko','Tapu Lele','Ursaluna','Ursaluna-Bloodmoon','Walking Wake','Weavile','Zapdos']],
  [15, ['Celebi','Dracovish','Goodra-Hisui','Heatran','Hoopa-Unbound','Incineroar','Infernape','Iron Hands','Iron Moth','Jirachi','Lycanroc-Dusk','Mamoswine','Mega Camerupt','Mega Heracross','Mega Pinsir','Mega Sceptile','Necrozma','Obstagoon','Ogerpon-Wellspring','Quaquaval','Salamence','Skarmory','Tangrowth','Ting-Lu','Togekiss','Toxapex','Tyranitar','Volcarona']],
  [14, ['Azumarill','Blissey','Ceruledge','Chansey','Conkeldurr','Deoxys-Defense','Excadrill','Hydrapple','Hydreigon','Iron Crown','Keldeo','Magnezone','Mandibuzz','Mega Aggron','Mega Houndoom','Mega Manectric','Mega Venusaur','Ninetales-Alola','Ogerpon-Cornerstone','Okidogi','Raging Bolt','Rotom-Wash','Samurott-Hisui','Sandy Shocks','Sylveon','Terrakion','Thundurus-Incarnate','Thundurus-Therian','Zoroark-Hisui']],
  [13, ['Aegislash','Alakazam','Azelf','Barraskewda','Clodsire','Espathra','Garganacl','Gengar','Grimmsnarl','Haxorus','Lilligant-Hisui','Mega Abomasnow','Mega Ampharos','Mega Sableye','Mega Steelix','Milotic','Moltres','Munkidori','Nidoking','Ogerpon','Pawmot','Pelipper','Raikou','Scream Tail','Skeledirge','Tapu Bulu','Volcanion','Zarude']],
  [12, ['Arcanine-Hisui','Basculegion-F','Basculegion-M','Cobalion','Cresselia','Darmanitan','Empoleon','Enamorus-Therian','Feraligatr','Gallade','Goodra','Gyarados','Hawlucha','Iron Leaves','Lucario','Mega Banette','Mega Beedrill','Mega Glalie','Mega Pidgeot','Mienshao','Moltres-Galar','Porygon2','Rotom-Heat','Slither Wing','Suicune','Swampert','Torkoal','Weezing-Galar','Zapdos-Galar']],
  [11, ['Amoonguss','Arcanine','Breloom','Chesnaught','Cloyster','Delphox','Dondozo','Entei','Glimmora','Hatterene','Hippowdon','Iron Jugulis','Kleavor','Krookodile','Mega Audino','Metagross','Mimikyu','Primarina','Regidrago','Serperior','Snorlax','Uxie']],
  [10, ['Armarouge','Bisharp','Chandelure','Ditto','Dudunsparce','Gigalith','Meloetta','Mesprit','Nidoqueen','Shaymin','Staraptor','Starmie','Tornadus-Incarnate','Umbreon','Vaporeon','Venusaur','Whimsicott']],
  [9, ['Araquanid','Blastoise','Braviary-Hisui','Brute Bonnet','Crawdaunt','Diancie','Donphan','Espeon','Fezandipiti','Floatzel','Florges','Flygon','Forretress','Gardevoir','Gastrodon','Gligar','Iron Thorns','Kilowattrel','Kingdra','Lokix','Mudsdale','Noivern','Overqwil','Polteageist','Quagsire','Regieleki','Rotom-Mow','Salazzle','Sinistcha','Swellow','Tauros-Paldea-Aqua','Tauros-Paldea-Blaze','Tinkaton','Toedscruel','Toxtricity','Vanilluxe','Virizion','Wo-Chien','Zoroark']],
  [8, ['Alomomola','Archeops','Arctozolt','Articuno-Galar','Barbaracle','Beartic','Cetitan','Clawitzer','Comfey','Dracozolt','Dragalge','Drednaw','Duraludon','Durant','Galvantula','Glastrier','Heracross','Hoopa','Indeedee-M','Inteleon','Jolteon','Klefki','Machamp','Maushold','Muk-Alola','Politoed','Porygon-Z','Registeel','Reuniclus','Revavroom','Rhyperior','Ribombee','Rotom-Fan','Slaking','Slowbro-Galar','Talonflame','Tauros','Torterra','Vikavolt','Weezing']],
  [7, ['Aerodactyl','Bewear','Boltund','Bronzong','Charizard','Cinccino','Cryogonal','Cyclizar','Decidueye-Hisui','Dhelmise','Drapion','Eelektross','Eiscue','Escavalier','Flamigo','Golisopod','Grafaiai','Hariyama','Heliolisk','Hitmonchan','Hitmonlee','Hitmontop','Honchkrow','Houndstone','Indeedee-F','Lycanroc-Midday','Mabosstiff','Mantine','Marowak-Alola','Miltank','Minior','Mismagius','Ninetales','Omastar','Orbeetle','Passimian','Primeape','Regice','Regirock','Seismitoad','Sigilyph','Sirfetch\'d','Slurpuff','Tauros-Paldea','Tentacruel','Tsareena','Tyrantrum','Ursaring']],
  [6, ['Arboliva','Articuno','Avalugg','Avalugg-Hisui','Basculin-Blue','Basculin-Red','Basculin-White','Bellossom','Bombirdier','Braviary','Claydol','Coalossal','Copperajah','Crobat','Crustle','Decidueye','Diggersby','Druddigon','Electivire','Electrode-Hisui','Frosmoth','Glaceon','Golurk','Gothitelle','Gurdurr','Kingler','Luxray','Muk','Pinsir','Poliwrath','Qwilfish-Hisui','Raichu','Raichu-Alola','Rotom-Frost','Runerigus','Sandslash-Alola','Sawk','Scolipede','Scyther','Shiftry','Tatsugiri','Throh','Typhlosion-Hisui','Veluza','Vileplume','Yanmega']],
  [5, ['Abomasnow','Aggron','Alcremie','Ambipom','Aurorus','Bellibolt','Bouffalant','Brambleghast','Bruxish','Carracosta','Cofagrigus','Cradily','Cursola','Dachsbun','Drampa','Exploud','Falinks','Farigiraf','Flapple','Froslass','Jellicent','Kabutops','Klinklang','Lapras','Leafeon','Lickilicky','Ludicolo','Lycanroc-Midnight','Magmortar','Malamar','Medicham','Mr. Rime','Musharna','Orthworm','Palossand','Pangoro','Perrserker','Rhydon','Roserade','Sableye','Sandaconda','Scovillain','Scrafty','Sharpedo','Spiritomb','Steelix','Toxicroak','Turtonator','Typhlosion','Venomoth','Vespiquen','Vivillon']],
  [4, ['Absol','Accelgor','Altaria','Ampharos','Appletun','Arctovish','Armaldo','Aromatisse','Crabominable','Dipplin','Dodrio','Drifblim','Dunsparce','Dusknoir','Eldegoss','Electrode','Emboar','Exeggutor','Exeggutor-Alola','Flareon','Gogoat','Golem-Alola','Gorebyss','Gourgeist','Greedent','Grumpig','Houndoom','Huntail','Klawf','Leavanny','Liepard','Lilligant','Linoone','Lurantis','Magneton','Masquerain','Meowstic-M','Naclstack','Oranguru','Oricorio','Oricorio-Pau','Oricorio-Pom-Pom','Oricorio-Sensu','Piloswine','Probopass','Rabsca','Rampardos','Rapidash','Rapidash-Galar','Regigigas','Samurott','Sawsbuck','Sceptile','Shuckle','Simipour','Simisage','Simisear','Sneasel','Sneasel-Hisui','Squawkabilly','Squawkabilly-Yellow','Stoutland','Stunfisk','Stunfisk-Galar','Swalot','Swoobat','Trevenant','Victreebel','Wyrdeer','Xatu','Zangoose']],
  [3, ['Audino','Bastiodon','Beheeyem','Bibarel','Cacturne','Calyrex','Camerupt','Carnivine','Centiskorch','Chimecho','Cramorant','Crocalor','Drakloak','Dubwool','Dugtrio','Dugtrio-Alola','Dusclops','Electabuzz','Garbodor','Golduck','Golem','Grapploct','Hattrem','Haunter','Kadabra','Kangaskhan','Komala','Lanturn','Lunatone','Magcargo','Magmar','Marowak','Meganium','Meowstic-F','Morpeko','Mothim','Mr. Mime','Mr. Mime-Galar','Ninjask','Persian-Alola','Pincurchin','Pyroar','Relicanth','Sandslash','Skuntank','Sliggoo','Sliggoo-Hisui','Solrock','Spidops','Stonjourner','Swanna','Tangela','Thwackey','Togedemaru','Togetic','Toucannon','Tropius','Unfezant','Walrein','Whiscash','Wishiwashi','Wugtrio','Zebstrika']],
  [2, ['Banette','Carbink','Carkol','Dewgong','Dottler','Doublade','Dragonair','Duosion','Ferroseed','Fraxure','Furfrou','Girafarig','Glalie','Golbat','Granbull','Graveler','Graveler-Alola','Hakamo-o','Hypno','Illumise','Jumpluff','Jynx','Kecleon','Klang','Kricketune','Linoone-Galar','Lopunny','Lumineon','Machoke','Manectric','Munchlax','Murkrow','Noctowl','Octillery','Oinkologne-F','Oinkologne-M','Phione','Pikachu','Porygon','Pyukumuku','Qwilfish','Raticate','Shiinotic','Stantler','Sudowoodo','Thievul','Vigoroth','Volbeat','Wailord','Wigglytuff']],
  [1, ['Abra','Aipom','Amaura','Anorith','Applin','Arbok','Archen','Arctibax','Ariados','Aron','Arrokuda','Axew','Azurill','Bagon','Baltoy','Barboach','Bayleef','Beautifly','Beedrill','Beldum','Bellsprout','Bergmite','Bidoof','Binacle','Blipbug','Blitzle','Boldore','Bonsly','Bounsweet','Braixen','Bramblin','Brionne','Bronzor','Budew','Buizel','Bulbasaur','Buneary','Bunnelby','Burmy','Butterfree','Cacnea','Capsakid','Carvanha','Cascoon','Castform','Caterpie','Cetoddle','Charcadet','Charjabug','Charmander','Charmeleon','Chatot','Cherrim','Cherubi','Chespin','Chewtle','Chikorita','Chimchar','Chinchou','Chingling','Clamperl','Clauncher','Clefairy','Cleffa','Clobbopus','Combee','Combusken','Corphish','Corsola','Corvisquire','Cosmoem','Cosmog','Cottonee','Crabrawler','Cranidos','Croagunk','Croconaw','Cubchoo','Cubone','Cufant','Cutiefly','Cyndaquil','Dartrix','Darumaka','Darumaka-Galar','Dedenne','Deerling','Deino','Delcatty','Delibird','Dewott','Dewpider','Diglett','Diglett-Alola','Doduo','Dolliv','Dratini','Dreepy','Drifloon','Drilbur','Drizzile','Drowzee','Ducklett','Duskull','Dustox','Dwebble','Eelektrik','Eevee','Ekans','Electrike','Elekid','Elgyem','Emolga','Espurr','Exeggcute','Farfetchd','Farfetchd-Galar','Fearow','Feebas','Fennekin','Fidough','Finizen','Finneon','Flaaffy','Flabebe','Fletchinder','Fletchling','Flittle','Floette','Floragato','Fomantis','Foongus','Frigibax','Frillish','Froakie','Frogadier','Fuecoco','Furret','Gabite','Gastly','Geodude','Geodude-Alola','Gible','Gimmighoul','Glameow','Glimmet','Gloom','Goldeen','Golett','Goomy','Gossifleur','Gothita','Gothorita','Greavard','Grimer','Grimer-Alola','Grookey','Grotle','Grovyle','Growlithe','Growlithe-Hisui','Grubbin','Gulpin','Gumshoos','Happiny','Hatenna','Heatmor','Helioptile','Herdier','Hippopotas','Honedge','Hoothoot','Hoppip','Horsea','Houndour','Igglybuff','Impidimp','Inkay','Ivysaur','Jangmo-o','Jigglypuff','Joltik','Kabuto','Kakuna','Karrablast','Kirlia','Klink','Koffing','Krabby','Kricketot','Krokorok','Kubfu','Lairon','Lampent','Larvesta','Larvitar','Lechonk','Ledian','Ledyba','Lickitung','Lileep','Lillipup','Litleo','Litten','Litwick','Lombre','Lotad','Loudred','Luvdisc','Luxio','Machop','Magby','Magikarp','Magnemite','Makuhita','Mankey','Mantyke','Maractus','Mareanie','Mareep','Marill','Marshtomp','Maschiff','Mawile','Meditite','Meowth','Meowth-Alola','Meowth-Galar','Metang','Metapod','Mienfoo','Mightyena','Milcery','Mime Jr.','Minccino','Minun','Misdreavus','Monferno','Morelull','Morgrem','Mudbray','Mudkip','Munna','Nacli','Natu','Nickit','Nidoran-F','Nidoran-M','Nidorina','Nidorino','Nincada','Noibat','Nosepass','Numel','Nuzleaf','Nymble','Oddish','Omanyte','Onix','Oshawott','Pachirisu','Palpitoad','Pancham','Panpour','Pansage','Pansear','Paras','Parasect','Patrat','Pawmi','Pawmo','Pawniard','Persian','Petilil','Phanpy','Phantump','Pichu','Pidgeot','Pidgeotto','Pidgey','Pidove','Pignite','Pikipek','Pineco','Piplup','Plusle','Poliwag','Poliwhirl','Poltchageist','Ponyta','Ponyta-Galar','Poochyena','Popplio','Prinplup','Psyduck','Pumpkaboo','Pupitar','Purrloin','Purugly','Quaxly','Quaxwell','Quilava','Quilladin','Raboot','Ralts','Raticate-Alola','Rattata','Rattata-Alola','Rellor','Remoraid','Rhyhorn','Riolu','Rockruff','Roggenrola','Rolycoly','Rookidee','Roselia','Rotom','Rowlet','Rufflet','Salandit','Sandile','Sandshrew','Sandshrew-Alola','Sandygast','Scatterbug','Scorbunny','Scraggy','Seadra','Seaking','Sealeo','Seedot','Seel','Sentret','Servine','Seviper','Sewaddle','Shelgon','Shellder','Shellos','Shelmet','Shieldon','Shinx','Shroodle','Shroomish','Shuppet','Silcoon','Silicobra','Sinistea','Sizzlipede','Skiddo','Skiploom','Skitty','Skorupi','Skrelp','Skwovet','Slakoth','Slowpoke','Slowpoke-Galar','Slugma','Smoliv','Smoochum','Snivy','Snom','Snorunt','Snover','Snubbull','Sobble','Solosis','Spearow','Spewpa','Spheal','Spinarak','Spinda','Spoink','Sprigatito','Spritzee','Squirtle','Staravia','Starly','Staryu','Steenee','Stufful','Stunky','Sunflora','Surskit','Swablu','Swadloon','Swinub','Swirlix','Tadbulb','Taillow','Tandemaus','Tarountula','Teddiursa','Tentacool','Tepig','Timburr','Tinkatink','Tinkatuff','Tirtouga','Toedscool','Togepi','Torchic','Torracat','Totodile','Toxel','Tranquill','Trapinch','Treecko','Trubbish','Trumbeak','Turtwig','Tympole','Tynamo','Tyrogue','Tyrunt','Unown','Vanillish','Vanillite','Varoom','Venipede','Venonat','Vibrava','Voltorb','Voltorb-Hisui','Vullaby','Vulpix','Vulpix-Alola','Wailmer','Wartortle','Watchog','Wattrel','Weedle','Weepinbell','Whirlipede','Whismur','Wiglett','Wimpod','Wingull','Wobbuffet','Woobat','Wooloo','Wooper','Wooper-Paldea','Wormadam','Wormadam-Sandy','Wormadam-Trash','Wurmple','Yamask','Yamask-Galar','Yamper','Yanma','Yungoos','Zigzagoon','Zigzagoon-Galar','Zorua','Zorua-Hisui','Zubat','Zweilous']],
];

// Build the full tier list as a flat array
export const TIER_LIST: TierEntry[] = TIERS_RAW.flatMap(([tier, names]) =>
  names.map(name => ({
    name,
    tier,
    teraCost: TERA_COST_MAP[tier] ?? tier,
    teraBanned: TERA_BANNED.includes(name),
  }))
);

// Quick lookup by name
const tierMap = new Map<string, TierEntry>();
for (const entry of TIER_LIST) tierMap.set(entry.name, entry);
export function getTierEntry(name: string): TierEntry | undefined {
  return tierMap.get(name);
}

/** Get the effective point cost for a Pokemon on a roster */
export function getEffectiveCost(name: string, isTeraCaptain: boolean): number {
  const entry = tierMap.get(name);
  if (!entry) return 0;
  return isTeraCaptain ? entry.teraCost : entry.tier;
}

/** Check if a Pokemon can be a tera captain (tiers 1-9 only, not tera-banned) */
export function canBeTeraCaptain(name: string): boolean {
  const entry = tierMap.get(name);
  if (!entry) return false;
  if (entry.teraBanned) return false;
  if (entry.tier > 9) return false;
  return true;
}

/** Total Pokemon in tier list */
export const TIER_LIST_SIZE = TIER_LIST.length;
