import type { Player } from '@/lib/types';

export const players: Player[] = [
  {
    id: 'sas', name: 'Liam', teamName: 'Survival Area Spartans', teamAbbrev: 'SAS',
    teamColor: '#ee8130', record: { wins: 9, losses: 2, differential: 27 },
    roster: [
      { name: 'Mega Blastoise', types: ['water'], tier: 20, isTeraCaptain: false, stats: { hp: 79, atk: 103, def: 120, spa: 135, spd: 115, spe: 78 }, abilities: ['Mega Launcher'], seasonStats: { kills: 20, deaths: 6, gp: 11 } },
      { name: 'Mandibuzz', types: ['dark', 'flying'], tier: 15, isTeraCaptain: false, stats: { hp: 110, atk: 115, def: 60, spa: 55, spd: 95, spe: 80 }, abilities: ['Intimidate', 'Overcoat'], seasonStats: { kills: 8, deaths: 5, gp: 11 } },
      { name: 'Delphox', types: ['fire', 'psychic'], tier: 11, isTeraCaptain: false, stats: { hp: 75, atk: 69, def: 72, spa: 114, spd: 100, spe: 104 }, abilities: ['Blaze', 'Magician'], seasonStats: { kills: 7, deaths: 4, gp: 11 } },
      { name: 'Crabominable', types: ['fighting', 'ice'], tier: 4, isTeraCaptain: true, teraTypes: ['ice', 'fighting', 'ground'], stats: { hp: 97, atk: 132, def: 77, spa: 62, spd: 67, spe: 43 }, abilities: ['Hyper Cutter', 'Iron Fist'], seasonStats: { kills: 5, deaths: 3, gp: 9 } },
      { name: 'Mudsdale', types: ['ground'], tier: 11, isTeraCaptain: false, stats: { hp: 100, atk: 125, def: 100, spa: 55, spd: 85, spe: 35 }, abilities: ['Own Tempo', 'Stamina'], seasonStats: { kills: 4, deaths: 4, gp: 11 } },
      { name: 'Aerodactyl', types: ['rock', 'flying'], tier: 7, isTeraCaptain: true, teraTypes: ['rock', 'ground', 'steel'], stats: { hp: 80, atk: 105, def: 65, spa: 60, spd: 75, spe: 130 }, abilities: ['Rock Head', 'Pressure', 'Unnerve'], seasonStats: { kills: 6, deaths: 5, gp: 10 } },
      { name: 'Pikachu', types: ['electric'], tier: 1, isTeraCaptain: false, stats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 }, abilities: ['Static', 'Lightning Rod'], seasonStats: { kills: 2, deaths: 4, gp: 7 } },
      { name: 'Slowking-Galar', types: ['poison', 'psychic'], tier: 16, isTeraCaptain: false, stats: { hp: 95, atk: 65, def: 80, spa: 110, spd: 110, spe: 30 }, abilities: ['Curious Medicine', 'Own Tempo', 'Regenerator'], seasonStats: { kills: 9, deaths: 3, gp: 11 } },
      { name: 'Charizard', types: ['fire', 'flying'], tier: 7, isTeraCaptain: false, stats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, abilities: ['Blaze', 'Solar Power'], seasonStats: { kills: 5, deaths: 6, gp: 10 } },
      { name: 'Marowak-Alola', types: ['fire', 'ghost'], tier: 7, isTeraCaptain: false, stats: { hp: 60, atk: 80, def: 110, spa: 50, spd: 80, spe: 45 }, abilities: ['Cursed Body', 'Lightning Rod', 'Rock Head'], seasonStats: { kills: 3, deaths: 5, gp: 8 } },
    ],
  },
  {
    id: 'llb', name: 'Patrick', teamName: 'Lumiose Bamboozlers', teamAbbrev: 'LLB',
    teamColor: '#6390f0', record: { wins: 8, losses: 3, differential: 16 },
    roster: [
      { name: 'Mega Gyarados', types: ['water', 'dark'], tier: 18, isTeraCaptain: false, stats: { hp: 95, atk: 155, def: 109, spa: 70, spd: 130, spe: 81 }, abilities: ['Mold Breaker'], seasonStats: { kills: 17, deaths: 5, gp: 11 } },
      { name: 'Blaziken', types: ['fire', 'fighting'], tier: 16, isTeraCaptain: false, stats: { hp: 80, atk: 120, def: 70, spa: 110, spd: 70, spe: 80 }, abilities: ['Blaze', 'Speed Boost'], seasonStats: { kills: 13, deaths: 7, gp: 11 } },
      { name: 'Ribombee', types: ['bug', 'fairy'], tier: 8, isTeraCaptain: false, stats: { hp: 60, atk: 55, def: 60, spa: 95, spd: 70, spe: 124 }, abilities: ['Honey Gather', 'Shield Dust', 'Sweet Veil'], seasonStats: { kills: 6, deaths: 4, gp: 11 } },
      { name: 'Conkeldurr', types: ['fighting'], tier: 14, isTeraCaptain: false, stats: { hp: 105, atk: 140, def: 95, spa: 55, spd: 65, spe: 45 }, abilities: ['Guts', 'Sheer Force', 'Iron Fist'], seasonStats: { kills: 10, deaths: 5, gp: 11 } },
      { name: 'Ceruledge', types: ['fire', 'ghost'], tier: 14, isTeraCaptain: false, stats: { hp: 75, atk: 125, def: 80, spa: 60, spd: 100, spe: 85 }, abilities: ['Flash Fire', 'Weak Armor'], seasonStats: { kills: 8, deaths: 6, gp: 11 } },
      { name: 'Gliscor', types: ['ground', 'flying'], tier: 17, isTeraCaptain: false, stats: { hp: 75, atk: 95, def: 125, spa: 45, spd: 75, spe: 95 }, abilities: ['Hyper Cutter', 'Sand Veil', 'Poison Heal'], seasonStats: { kills: 4, deaths: 3, gp: 11 } },
      { name: 'Cofagrigus', types: ['ghost'], tier: 8, isTeraCaptain: true, teraTypes: ['ghost', 'dark', 'normal'], stats: { hp: 58, atk: 50, def: 145, spa: 95, spd: 105, spe: 30 }, abilities: ['Mummy'], seasonStats: { kills: 3, deaths: 4, gp: 9 } },
      { name: 'Avalugg', types: ['ice', 'water'], tier: 6, isTeraCaptain: true, teraTypes: ['water', 'ice', 'steel'], stats: { hp: 75, atk: 80, def: 110, spa: 65, spd: 80, spe: 30 }, abilities: ['Own Tempo', 'Ice Body'], seasonStats: { kills: 2, deaths: 4, gp: 8 } },
      { name: 'Zoroark', types: ['dark'], tier: 10, isTeraCaptain: false, stats: { hp: 60, atk: 105, def: 60, spa: 120, spd: 60, spe: 105 }, abilities: ['Illusion'], seasonStats: { kills: 6, deaths: 5, gp: 10 } },
      { name: 'Ferroseed', types: ['grass', 'steel'], tier: 1, isTeraCaptain: false, stats: { hp: 44, atk: 50, def: 91, spa: 24, spd: 86, spe: 10 }, abilities: ['Iron Barbs'], seasonStats: { kills: 1, deaths: 3, gp: 5 } },
    ],
  },
  {
    id: 'vvv', name: 'Nate', teamName: 'Veldstone Vikavolts', teamAbbrev: 'VVV',
    teamColor: '#f7d02c', record: { wins: 7, losses: 4, differential: 12 },
    roster: [
      { name: 'Meowscarada', types: ['grass', 'dark'], tier: 17, isTeraCaptain: false, stats: { hp: 76, atk: 110, def: 70, spa: 81, spd: 70, spe: 123 }, abilities: ['Overgrow', 'Protean'], seasonStats: { kills: 13, deaths: 5, gp: 11 } },
      { name: 'Rotom-Wash', types: ['electric', 'water'], tier: 14, isTeraCaptain: false, stats: { hp: 50, atk: 65, def: 107, spa: 105, spd: 107, spe: 86 }, abilities: ['Levitate'], seasonStats: { kills: 7, deaths: 4, gp: 11 } },
      { name: 'Gholdengo', types: ['steel', 'ghost'], tier: 17, isTeraCaptain: false, stats: { hp: 87, atk: 60, def: 91, spa: 133, spd: 91, spe: 84 }, abilities: ['Good as Gold'], seasonStats: { kills: 11, deaths: 6, gp: 11 } },
      { name: 'Sylveon', types: ['fairy'], tier: 14, isTeraCaptain: false, stats: { hp: 95, atk: 65, def: 65, spa: 110, spd: 130, spe: 60 }, abilities: ['Cute Charm', 'Pixilate'], seasonStats: { kills: 6, deaths: 3, gp: 11 } },
      { name: 'Machamp', types: ['fighting'], tier: 11, isTeraCaptain: false, stats: { hp: 90, atk: 130, def: 80, spa: 65, spd: 85, spe: 55 }, abilities: ['Guts', 'No Guard', 'Steadfast'], seasonStats: { kills: 8, deaths: 7, gp: 11 } },
      { name: 'Serperior', types: ['grass'], tier: 11, isTeraCaptain: false, stats: { hp: 75, atk: 75, def: 95, spa: 75, spd: 95, spe: 113 }, abilities: ['Overgrow', 'Contrary'], seasonStats: { kills: 5, deaths: 4, gp: 10 } },
      { name: 'Porygon2', types: ['normal'], tier: 12, isTeraCaptain: false, stats: { hp: 85, atk: 80, def: 90, spa: 105, spd: 95, spe: 60 }, abilities: ['Trace', 'Download', 'Analytic'], seasonStats: { kills: 4, deaths: 3, gp: 9 } },
      { name: 'Salazzle', types: ['poison', 'fire'], tier: 10, isTeraCaptain: true, teraTypes: ['fire', 'poison', 'grass'], stats: { hp: 68, atk: 64, def: 60, spa: 111, spd: 60, spe: 117 }, abilities: ['Corrosion', 'Oblivious'], seasonStats: { kills: 5, deaths: 5, gp: 9 } },
      { name: 'Masquerain', types: ['bug', 'flying'], tier: 4, isTeraCaptain: true, teraTypes: ['water', 'bug', 'ice'], stats: { hp: 70, atk: 60, def: 62, spa: 100, spd: 82, spe: 80 }, abilities: ['Intimidate', 'Unnerve'], seasonStats: { kills: 3, deaths: 6, gp: 8 } },
      { name: 'Fraxure', types: ['dragon'], tier: 2, isTeraCaptain: false, stats: { hp: 66, atk: 117, def: 70, spa: 40, spd: 50, spe: 67 }, abilities: ['Rivalry', 'Mold Breaker', 'Unnerve'], seasonStats: { kills: 2, deaths: 4, gp: 6 } },
    ],
  },
  {
    id: 'gwg', name: 'Giuliano', teamName: 'Glenwood Gremlins', teamAbbrev: 'GWG',
    teamColor: '#7ac74c', record: { wins: 7, losses: 4, differential: 9 },
    roster: [],
  },
  {
    id: 'dwg', name: 'Dylan', teamName: 'Distortion World Ghouls', teamAbbrev: 'DWG',
    teamColor: '#735797', record: { wins: 7, losses: 4, differential: 7 },
    roster: [],
  },
  {
    id: 'ak', name: 'AK', teamName: 'Ascomnia Kadabras', teamAbbrev: 'AK',
    teamColor: '#f95587', record: { wins: 7, losses: 4, differential: 6 },
    roster: [],
  },
  {
    id: 'mgm', name: 'Garrett', teamName: 'Metagoza Marowaks', teamAbbrev: 'MGM',
    teamColor: '#a33ea1', record: { wins: 6, losses: 5, differential: 11 },
    roster: [],
  },
  {
    id: 'fam', name: 'Alex', teamName: 'Flight Area Manhattan', teamAbbrev: 'FAM',
    teamColor: '#6f35fc', record: { wins: 5, losses: 6, differential: 1 },
    roster: [],
  },
  {
    id: 'ece', name: 'Devon', teamName: 'Eterna City Ethernaults', teamAbbrev: 'ECE',
    teamColor: '#96d9d6', record: { wins: 4, losses: 7, differential: -6 },
    roster: [],
  },
  {
    id: 'gg', name: 'Jacob', teamName: 'Goldenrod Gangsters', teamAbbrev: 'GG',
    teamColor: '#f7d02c', record: { wins: 3, losses: 8, differential: -16 },
    roster: [],
  },
  {
    id: 'pow', name: 'Saviour', teamName: "Paldea's Overheated Wasteland", teamAbbrev: 'POW',
    teamColor: '#ee8130', record: { wins: 2, losses: 9, differential: -22 },
    roster: [],
  },
  {
    id: 'hmm', name: 'Mike', teamName: 'Hearthome Machineous Munchblazers', teamAbbrev: 'HMM',
    teamColor: '#b7b7ce', record: { wins: 1, losses: 10, differential: -35 },
    roster: [],
  },
];

/** Players sorted by standings (wins desc, differential desc) */
export const standings = [...players].sort((a, b) => {
  if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
  return b.record.differential - a.record.differential;
});
