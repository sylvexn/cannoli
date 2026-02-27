/**
 * Full tier list parsed from reference/tiers.
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

// ─── Banned Pokemon ─────────────────────────────────────────────
export const BANNED: string[] = [
  'Arceus','Arceus-Bug','Arceus-Dark','Arceus-Dragon','Arceus-Electric','Arceus-Fairy','Arceus-Fighting','Arceus-Fire','Arceus-Flying','Arceus-Ghost','Arceus-Grass','Arceus-Ground','Arceus-Ice','Arceus-Poison','Arceus-Psychic','Arceus-Rock','Arceus-Steel','Arceus-Water',
  'Articuno','Articuno-Galar','Azelf','Blacephalon','Brute Bonnet','Buzzwole','Calyrex','Calyrex-Ice','Calyrex-Shadow','Celebi','Celesteela','Chi-Yu','Chien-Pao','Cobalion','Corsola-Galar','Cosmoem','Cosmog','Cresselia','Darkrai',
  'Deoxys','Deoxys-Attack','Deoxys-Defense','Deoxys-Speed','Dialga','Diancie','Ditto','Enamorus-Incarnate','Enamorus-Therian','Entei','Eternatus','Fezandipiti','Flutter Mane','Genesect','Giratina','Glastrier','Gouging Fire','Great Tusk','Groudon','Guzzlord',
  'Heatran','Ho-Oh','Hoopa','Hoopa-Unbound','Iron Boulder','Iron Bundle','Iron Crown','Iron Hands','Iron Jugulis','Iron Leaves','Iron Moth','Iron Thorns','Iron Treads','Iron Valiant','Jirachi','Kartana','Keldeo','Koraidon','Kubfu','Kyogre','Kyurem','Kyurem-Black','Kyurem-White',
  'Landorus-Incarnate','Landorus-Therian','Latias','Latios','Lugia','Lunala','Magearna','Manaphy','Marshadow',
  'Mega Blaziken','Mega Diancie','Mega Gengar','Mega Kangaskhan','Mega Latias','Mega Latios','Mega Lucario','Mega Metagross','Mega Mewtwo X','Mega Mewtwo Y','Mega Rayquaza','Mega Salamence',
  'Melmetal','Meloetta','Meltan','Mesprit','Mew','Mewtwo','Miraidon','Moltres','Moltres-Galar','Munkidori','Naganadel','Necrozma','Necrozma-Dawn','Necrozma-Dusk','Necrozma-Ultra','Nihilego',
  'Ogerpon','Ogerpon-Cornerstone','Ogerpon-Hearthflame','Ogerpon-Wellspring','Okidogi','Palkia','Pecharunt','Pheromosa','Phione','Poipole',
  'Primal Groudon','Primal Kyogre','Raging Bolt','Raikou','Rayquaza','Regice','Regidrago','Regieleki','Regigigas','Regirock','Registeel','Reshiram','Roaring Moon','Sandy Shocks','Scream Tail',
  'Shaymin','Shaymin-Sky','Shedinja','Silvally','Slither Wing','Smeargle','Solgaleo','Spectrier','Stakataka','Suicune','Sunkern',
  'Tapu Bulu','Tapu Fini','Tapu Koko','Tapu Lele','Terapagos','Terapagos-Stellar','Terapagos-Terastal','Terrakion','Thundurus-Incarnate','Thundurus-Therian','Ting-Lu','Tornadus-Incarnate','Tornadus-Therian','Type: Null',
  'Urshifu-Rapid-Strike','Urshifu-Single-Strike','Uxie','Victini','Virizion','Volcanion','Walking Wake','Wo-Chien','Wynaut','Xerneas','Xurkitree','Yveltal',
  'Zacian','Zacian-Crowned','Zamazenta','Zamazenta-Crowned','Zapdos','Zapdos-Galar','Zarude','Zekrom','Zeraora','Zygarde','Zygarde-10','Zygarde-Complete',
];

// ─── Tera Banned (can be drafted, cannot be tera captain) ────────
export const TERA_BANNED: string[] = [
  'Alcremie','Blastoise','Cetitan','Kingdra','Linoone','Lokix','Polteageist','Reuniclus','Sinistcha','Swellow','Toxtricity','Venomoth',
];

// ─── Full tier list (20pt → 1pt) ────────────────────────────────
const TIERS_RAW: [number, string[]][] = [
  [20, ['Kommo-o','Mega Blastoise','Mega Charizard X','Mega Charizard Y','Mega Garchomp','Mega Gyarados','Mega Tyranitar','Palafin']],
  [19, ['Mega Aerodactyl','Mega Alakazam','Mega Mawile','Mega Medicham','Mega Scizor','Mega Swampert']],
  [18, ['Baxcalibur','Dragapult','Dragonite','Garchomp','Greninja','Mega Altaria','Mega Gardevoir','Mega Lopunny','Mega Sharpedo','Mega Venusaur']],
  [17, ['Annihilape','Archaludon','Corviknight','Darmanitan-Galar','Gholdengo','Gliscor','Kingambit','Mega Aggron','Mega Gallade','Mega Heracross','Mega Pinsir','Mega Slowbro','Meowscarada','Slowbro','Toxapex']],
  [16, ['Blaziken','Blissey','Cinderace','Clefable','Dracovish','Ferrothorn','Incineroar','Mega Absol','Mega Camerupt','Mega Sableye','Scizor','Slowking','Slowking-Galar','Sneasler','Ursaluna','Ursaluna-Bloodmoon','Weavile']],
  [15, ['Chansey','Goodra-Hisui','Infernape','Lycanroc-Dusk','Mamoswine','Mega Abomasnow','Mega Ampharos','Mega Beedrill','Mega Houndoom','Mega Manectric','Mega Sceptile','Mega Steelix','Obstagoon','Quaquaval','Rillaboom','Salamence','Tangrowth','Togekiss','Tyranitar','Volcarona','Zoroark-Hisui']],
  [14, ['Azumarill','Ceruledge','Conkeldurr','Excadrill','Hydrapple','Hydreigon','Magnezone','Mandibuzz','Mega Banette','Mega Glalie','Mega Pidgeot','Ninetales-Alola','Rotom-Wash','Samurott-Hisui','Skarmory','Skeledirge','Sylveon']],
  [13, ['Aegislash','Alakazam','Barraskewda','Clodsire','Espathra','Garganacl','Gengar','Grimmsnarl','Haxorus','Mega Audino','Milotic','Nidoking','Pawmot','Pelipper']],
  [12, ['Amoonguss','Arcanine-Hisui','Basculegion-F','Basculegion-M','Darmanitan','Empoleon','Feraligatr','Gallade','Goodra','Gyarados','Hawlucha','Lilligant-Hisui','Lucario','Mienshao','Porygon2','Rotom-Heat','Swampert','Torkoal','Weezing-Galar']],
  [11, ['Arcanine','Breloom','Chesnaught','Cloyster','Delphox','Dondozo','Gigalith','Glimmora','Hatterene','Hippowdon','Kleavor','Krookodile','Metagross','Mimikyu','Mudsdale','Primarina','Serperior','Snorlax','Staraptor']],
  [10, ['Armarouge','Bisharp','Chandelure','Dudunsparce','Gligar','Nidoqueen','Salazzle','Starmie','Tauros-Paldea-Aqua','Tauros-Paldea-Blaze','Umbreon','Vaporeon','Venusaur','Whimsicott','Zoroark']],
  [9, ['Araquanid','Blastoise','Braviary-Hisui','Crawdaunt','Donphan','Espeon','Floatzel','Florges','Flygon','Forretress','Gardevoir','Gastrodon','Kilowattrel','Kingdra','Noivern','Overqwil','Polteageist','Quagsire','Rotom-Mow','Sinistcha','Tinkaton','Toedscruel','Toxtricity','Vanilluxe']],
  [8, ['Alomomola','Archeops','Arctozolt','Barbaracle','Beartic','Bronzong','Cetitan','Clawitzer','Comfey','Dracozolt','Dragalge','Drednaw','Duraludon','Durant','Galvantula','Heracross','Indeedee-M','Inteleon','Jolteon','Klefki','Machamp','Maushold','Politoed','Porygon-Z','Reuniclus','Revavroom','Rhyperior','Ribombee','Rotom-Fan','Slaking','Slowbro-Galar','Talonflame','Tauros','Torterra','Vikavolt','Weezing']],
  [7, ['Aerodactyl','Bewear','Boltund','Charizard','Cinccino','Cryogonal','Cyclizar','Decidueye-Hisui','Dhelmise','Drapion','Eelektross','Eiscue','Escavalier','Flamigo','Golisopod','Grafaiai','Hariyama','Heliolisk','Hitmonchan','Hitmonlee','Hitmontop','Honchkrow','Houndstone','Indeedee-F','Lokix','Lycanroc-Midday','Mabosstiff','Mantine','Marowak-Alola','Miltank','Minior','Mismagius','Muk-Alola','Ninetales','Omastar','Orbeetle','Passimian','Primeape','Seismitoad','Sigilyph','Sirfetch\'d','Slurpuff','Tauros-Paldea','Tentacruel','Tsareena','Tyrantrum','Ursaring']],
  [6, ['Arboliva','Avalugg','Avalugg-Hisui','Basculin-Blue','Basculin-Red','Basculin-White','Bellossom','Bombirdier','Braviary','Claydol','Coalossal','Copperajah','Crobat','Crustle','Decidueye','Diggersby','Druddigon','Electivire','Electrode-Hisui','Frosmoth','Glaceon','Golurk','Gothitelle','Gurdurr','Kingler','Luxray','Muk','Pinsir','Poliwrath','Qwilfish-Hisui','Raichu','Raichu-Alola','Rotom-Frost','Runerigus','Sandslash-Alola','Sawk','Scolipede','Scyther','Shiftry','Swellow','Tatsugiri','Throh','Typhlosion-Hisui','Veluza','Vileplume','Yanmega']],
  [5, ['Abomasnow','Aggron','Alcremie','Ambipom','Aurorus','Bellibolt','Bouffalant','Brambleghast','Bruxish','Carracosta','Cofagrigus','Cradily','Cursola','Dachsbun','Drampa','Exploud','Falinks','Farigiraf','Flapple','Froslass','Jellicent','Kabutops','Klinklang','Lapras','Leafeon','Lickilicky','Lycanroc-Midnight','Magmortar','Malamar','Medicham','Mr. Rime','Musharna','Orthworm','Palossand','Pangoro','Perrserker','Rhydon','Roserade','Sableye','Sandaconda','Scovillain','Scrafty','Sharpedo','Spiritomb','Steelix','Toxicroak','Turtonator','Typhlosion','Vespiquen','Vivillon']],
  [4, ['Absol','Accelgor','Altaria','Ampharos','Appletun','Arctovish','Armaldo','Aromatisse','Crabominable','Dipplin','Dodrio','Drifblim','Dunsparce','Dusknoir','Eldegoss','Electrode','Emboar','Exeggutor','Exeggutor-Alola','Flareon','Gogoat','Golem-Alola','Gorebyss','Gourgeist','Greedent','Grumpig','Houndoom','Huntail','Klawf','Leavanny','Liepard','Lilligant','Linoone','Ludicolo','Lurantis','Magneton','Masquerain','Meowstic-M','Naclstack','Oranguru','Oricorio','Oricorio-Pau','Oricorio-Pom-Pom','Oricorio-Sensu','Piloswine','Probopass','Rabsca','Rampardos','Rapidash','Rapidash-Galar','Samurott','Sawsbuck','Sceptile','Shuckle','Simipour','Simisage','Simisear','Sneasel','Sneasel-Hisui','Squawkabilly','Squawkabilly-Yellow','Stoutland','Stunfisk','Stunfisk-Galar','Swalot','Swoobat','Trevenant','Venomoth','Victreebel','Wyrdeer','Xatu','Zangoose']],
  [3, ['Audino','Bastiodon','Beheeyem','Bibarel','Cacturne','Camerupt','Carnivine','Centiskorch','Chimecho','Cramorant','Crocalor','Drakloak','Dubwool','Dugtrio','Dugtrio-Alola','Dusclops','Electabuzz','Garbodor','Golduck','Golem','Grapploct','Hattrem','Haunter','Kadabra','Kangaskhan','Komala','Lanturn','Lunatone','Magcargo','Magmar','Marowak','Meganium','Meowstic-F','Morpeko','Mothim','Mr. Mime','Mr. Mime-Galar','Ninjask','Pincurchin','Pyroar','Relicanth','Sandslash','Skuntank','Sliggoo','Sliggoo-Hisui','Solrock','Spidops','Stonjourner','Swanna','Tangela','Thwackey','Togedemaru','Togetic','Toucannon','Tropius','Unfezant','Walrein','Whiscash','Wishiwashi','Wugtrio','Zebstrika']],
  [2, ['Banette','Carbink','Carkol','Dewgong','Dottler','Doublade','Dragonair','Duosion','Fraxure','Furfrou','Girafarig','Glalie','Golbat','Granbull','Graveler','Graveler-Alola','Hakamo-o','Hypno','Illumise','Jumpluff','Jynx','Kecleon','Klang','Kricketune','Linoone-Galar','Lopunny','Lumineon','Machoke','Manectric','Munchlax','Murkrow','Noctowl','Octillery','Oinkologne-F','Oinkologne-M','Persian-Alola','Pyukumuku','Qwilfish','Raticate','Shiinotic','Stantler','Sudowoodo','Thievul','Vigoroth','Volbeat','Wailord','Wigglytuff']],
  [1, ['Abra','Aipom','Amaura','Anorith','Applin','Arbok','Archen','Arctibax','Ariados','Aron','Arrokuda','Axew','Azurill','Bagon','Baltoy','Barboach','Bayleef','Beautifly','Beedrill','Beldum','Bellsprout','Bergmite','Bidoof','Binacle','Blipbug','Blitzle','Boldore','Bonsly','Bounsweet','Braixen','Bramblin','Brionne','Bronzor','Budew','Buizel','Bulbasaur','Buneary','Bunnelby','Burmy','Butterfree','Cacnea','Capsakid','Carvanha','Cascoon','Castform','Caterpie','Cetoddle','Charcadet','Charjabug','Charmander','Charmeleon','Chatot','Cherrim','Cherubi','Chespin','Chewtle','Chikorita','Chimchar','Chinchou','Chingling','Clamperl','Clauncher','Clefairy','Cleffa','Clobbopus','Combee','Combusken','Corphish','Corsola','Corvisquire','Cottonee','Crabrawler','Cranidos','Croagunk','Croconaw','Cubchoo','Cubone','Cufant','Cutiefly','Cyndaquil','Dartrix','Darumaka','Darumaka-Galar','Dedenne','Deerling','Deino','Delcatty','Delibird','Dewott','Dewpider','Diglett','Diglett-Alola','Doduo','Dolliv','Dratini','Dreepy','Drifloon','Drilbur','Drizzile','Drowzee','Ducklett','Duskull','Dustox','Dwebble','Eelektrik','Eevee','Ekans','Electrike','Elekid','Elgyem','Emolga','Espurr','Exeggcute','Farfetchd','Farfetchd-Galar','Fearow','Feebas','Fennekin','Ferroseed','Fidough','Finizen','Finneon','Flaaffy','Flabebe','Fletchinder','Fletchling','Flittle','Floette','Floragato','Fomantis','Foongus','Frigibax','Frillish','Froakie','Frogadier','Fuecoco','Furret','Gabite','Gastly','Geodude','Geodude-Alola','Gible','Gimmighoul','Glameow','Glimmet','Gloom','Goldeen','Golett','Goomy','Gossifleur','Gothita','Gothorita','Greavard','Grimer','Grimer-Alola','Grookey','Grotle','Grovyle','Growlithe','Growlithe-Hisui','Grubbin','Gulpin','Gumshoos','Happiny','Hatenna','Heatmor','Helioptile','Herdier','Hippopotas','Honedge','Hoothoot','Hoppip','Horsea','Houndour','Igglybuff','Impidimp','Inkay','Ivysaur','Jangmo-o','Jigglypuff','Joltik','Kabuto','Kakuna','Karrablast','Kirlia','Klink','Koffing','Krabby','Kricketot','Krokorok','Lairon','Lampent','Larvesta','Larvitar','Lechonk','Ledian','Ledyba','Lickitung','Lileep','Lillipup','Litleo','Litten','Litwick','Lombre','Lotad','Loudred','Luvdisc','Luxio','Machop','Magby','Magikarp','Magnemite','Makuhita','Mankey','Mantyke','Maractus','Mareanie','Mareep','Marill','Marshtomp','Maschiff','Mawile','Meditite','Meowth','Meowth-Alola','Meowth-Galar','Metang','Metapod','Mienfoo','Mightyena','Milcery','Mime Jr.','Minccino','Minun','Misdreavus','Monferno','Morelull','Morgrem','Mudbray','Mudkip','Munna','Nacli','Natu','Nickit','Nidoran-F','Nidoran-M','Nidorina','Nidorino','Nincada','Noibat','Nosepass','Numel','Nuzleaf','Nymble','Oddish','Omanyte','Onix','Oshawott','Pachirisu','Palpitoad','Pancham','Panpour','Pansage','Pansear','Paras','Parasect','Patrat','Pawmi','Pawmo','Pawniard','Persian','Petilil','Phanpy','Phantump','Pichu','Pidgeot','Pidgeotto','Pidgey','Pidove','Pignite','Pikachu','Pikipek','Pineco','Piplup','Plusle','Poliwag','Poliwhirl','Poltchageist','Ponyta','Ponyta-Galar','Poochyena','Popplio','Porygon','Prinplup','Psyduck','Pumpkaboo','Pupitar','Purrloin','Purugly','Quaxly','Quaxwell','Quilava','Quilladin','Raboot','Ralts','Raticate-Alola','Rattata','Rattata-Alola','Rellor','Remoraid','Rhyhorn','Riolu','Rockruff','Roggenrola','Rolycoly','Rookidee','Roselia','Rotom','Rowlet','Rufflet','Salandit','Sandile','Sandshrew','Sandshrew-Alola','Sandygast','Scatterbug','Scorbunny','Scraggy','Seadra','Seaking','Sealeo','Seedot','Seel','Sentret','Servine','Seviper','Sewaddle','Shelgon','Shellder','Shellos','Shelmet','Shieldon','Shinx','Shroodle','Shroomish','Shuppet','Silcoon','Silicobra','Sinistea','Sizzlipede','Skiddo','Skiploom','Skitty','Skorupi','Skrelp','Skwovet','Slakoth','Slowpoke','Slowpoke-Galar','Slugma','Smoliv','Smoochum','Snivy','Snom','Snorunt','Snover','Snubbull','Sobble','Solosis','Spearow','Spewpa','Spheal','Spinarak','Spinda','Spoink','Sprigatito','Spritzee','Squirtle','Staravia','Starly','Staryu','Steenee','Stufful','Stunky','Sunflora','Surskit','Swablu','Swadloon','Swinub','Swirlix','Tadbulb','Taillow','Tandemaus','Tarountula','Teddiursa','Tentacool','Tepig','Timburr','Tinkatink','Tinkatuff','Tirtouga','Toedscool','Togepi','Torchic','Torracat','Totodile','Toxel','Tranquill','Trapinch','Treecko','Trubbish','Trumbeak','Turtwig','Tympole','Tynamo','Tyrogue','Tyrunt','Unown','Vanillish','Vanillite','Varoom','Venipede','Venonat','Vibrava','Voltorb','Voltorb-Hisui','Vullaby','Vulpix','Vulpix-Alola','Wailmer','Wartortle','Watchog','Wattrel','Weedle','Weepinbell','Whirlipede','Whismur','Wiglett','Wimpod','Wingull','Wobbuffet','Woobat','Wooloo','Wooper','Wooper-Paldea','Wormadam','Wormadam-Sandy','Wormadam-Trash','Wurmple','Yamask','Yamask-Galar','Yamper','Yanma','Yungoos','Zigzagoon','Zigzagoon-Galar','Zorua','Zorua-Hisui','Zubat','Zweilous']],
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
