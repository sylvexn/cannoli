/**
 * Display name → Showdown sprite filename. Server-side copy of
 * frontend/src/lib/pokemon.ts `toSpriteId` (the backend image has no access to
 * frontend/), used only to build the share-card image. Keep the override table
 * in sync when new odd forms are added there.
 */

const OVERRIDES: Record<string, string> = {
  'kommo-o': 'kommoo', 'hakamo-o': 'hakamoo', 'jangmo-o': 'jangmoo',
  'ho-oh': 'hooh', 'porygon-z': 'porygonz',
  'basculegion-m': 'basculegion', 'indeedee-m': 'indeedee',
  'meowstic-m': 'meowstic', 'oinkologne-m': 'oinkologne',
  'basculin-blue': 'basculin-bluestriped', 'basculin-red': 'basculin',
  'basculin-white': 'basculin-whitestriped',
  'oricorio-pom-pom': 'oricorio-pompom', 'lycanroc-midday': 'lycanroc',
  'nidoran-f': 'nidoranf', 'nidoran-m': 'nidoranm',
  "sirfetch'd": 'sirfetchd', "farfetch'd": 'farfetchd', "farfetch'd-galar": 'farfetchd-galar',
  'flabébé': 'flabebe',
  'tauros-paldea': 'tauros-paldeacombat', 'tauros-paldea-aqua': 'tauros-paldeaaqua',
  'tauros-paldea-blaze': 'tauros-paldeablaze', 'tauros-paldea-combat': 'tauros-paldeacombat',
  'urshifu-rapid-strike': 'urshifu-rapidstrike', 'urshifu-single-strike': 'urshifu',
  'ting-lu': 'tinglu', 'wo-chien': 'wochien', 'chien-pao': 'chienpao', 'chi-yu': 'chiyu',
  'thundurus-incarnate': 'thundurus', 'tornadus-incarnate': 'tornadus',
  'landorus-incarnate': 'landorus', 'enamorus-incarnate': 'enamorus',
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function toSpriteId(name: string): string {
  const n = name.trim();
  const o = OVERRIDES[n.toLowerCase()];
  if (o) return o;
  const megaXY = n.match(/^Mega\s+(.+)\s+([XY])$/i);
  if (megaXY) return `${clean(megaXY[1]!)}-mega${megaXY[2]!.toLowerCase()}`;
  const mega = n.match(/^Mega\s+(.+)$/i);
  if (mega) return `${clean(mega[1]!)}-mega`;
  const primal = n.match(/^Primal\s+(.+)$/i);
  if (primal) return `${clean(primal[1]!)}-primal`;
  if (n.includes('-')) return n.split('-').map(clean).join('-');
  return clean(n);
}
