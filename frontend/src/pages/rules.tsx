import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollText, Swords, Star, ShieldOff } from 'lucide-react';

const DRAFT_RULES: string[] = [
  'You have up to 110 points with which to draft 10–12 Pokémon. Costs are listed on the draft board. You do not have to spend your full budget.',
  'Pokémon cost anywhere between 1 – 20 points.',
  'The draft is a randomized snake-style draft (1→12, 12→1, etc.).',
  'If a Pokémon is picked by someone else, you cannot pick it.',
  'Tera Captains are limited to Tiers 9 and below, and have a multiplier applied to their cost when drafted as a Tera Captain (see Draft Board).',
  'You may have up to 2 Tera Captains from any tiers 9 and below. Tera Captains have 3 Tera Types, visible on each team\'s sheet. All three types are free, and Stellar Tera is banned.',
  'The deadline for trades and free agencies is Week 7.',
  'You can change tera types on each captain for free once per season.',
  'You change tera captains within your team for free when making a trade, or by using a FA. However, a Pokémon can only be a captain once.',
  'You cannot draft more than 1 Mega Pokémon, and Mega Pokémon need to have their Mega Stone in battle. They don\'t need to Mega Evolve.',
  'You cannot draft two Pokémon with the same National Dex number. This means you cannot draft two forms of the same Pokémon. Ex. Decidueye and Decidueye-Hisui, Rotom-Wash and Rotom-Heat or Mega Gardevoir and Gardevoir.',
];

const BATTLE_RULES: string[] = [
  'All games must be played in the NatDex Draft format with Tera Preview enabled on Pokémon Showdown.',
  'Each set is a best-of-one set.',
  'Either coach can turn the timer on without asking the other coach (Sapphire & Ruby).',
  'All Pokémon must be Level 100 and you must bring a team of 6 Pokémon to battle.',
  'Battles are done with Tera Preview, meaning the Tera Types of both teams are posted in the battle\'s chat box when choosing your lead Pokémon.',
];

const CLAUSES: { name: string; description: string }[] = [
  { name: 'Species Clause', description: 'A player cannot have two Pokémon with the same National Pokédex number on a team.' },
  { name: 'Sleep Clause', description: 'If a player has already put a Pokémon on their opponent\'s side to sleep and it is still sleeping, another one can\'t be put to sleep.' },
  { name: 'Evasion Clause', description: 'A Pokémon may not hold an item, use a move, or possess an ability that can increase their evasion stat.' },
  { name: 'OHKO Clause', description: 'A Pokémon may not have the moves Fissure, Guillotine, Horn Drill, or Sheer Cold in its moveset.' },
  { name: 'Moody Clause', description: 'A Pokémon may not enter battle with the ability Moody.' },
  { name: 'Endless Battle Clause', description: 'Players cannot intentionally prevent an opponent from being able to end the game without forfeiting.' },
  { name: 'Baton Pass Clause', description: 'A Pokémon may not have Baton Pass in its moveset.' },
  { name: 'Accuracy Moves Clause', description: 'A Pokémon may not have a move that lowers the opponent\'s accuracy.' },
];

const POKEMON_BANS: { pokemon: string; move: string }[] = [
  { pokemon: 'Mega Alakazam', move: 'Nasty Plot' },
  { pokemon: 'Palafin', move: 'Jet Punch' },
];

const BANNED_ABILITIES = ['Shadow Tag', 'Arena Trap', 'Moody'];
const BANNED_ITEMS = ['Bright Powder', 'Lax Incense', 'Razor Fang', "King's Rock"];
const BANNED_MOVES = [
  'Acupressure', 'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
  'Last Respects', 'Pursuit', 'Return', 'Revival Blessing', 'Shed Tail', 'Swagger',
];

const TERA_BANNED = [
  'Alcremie', 'Blastoise', 'Cetitan', 'Kingdra', 'Linoone', 'Lokix',
  'Polteageist', 'Reuniclus', 'Sinistcha', 'Swellow', 'Toxtricity', 'Venomoth',
];

export function RulesPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-pink">League</span>
          <span className="text-text-primary ml-1">Rules</span>
        </h1>
        <p className="text-sm text-text-muted">Cannoli draft and battle rules — read before drafting.</p>
      </div>

      {/* Draft Rules */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText size={16} className="text-neon" />
            Draft Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm text-text-secondary list-decimal pl-5">
            {DRAFT_RULES.map((rule, i) => (
              <li key={i} className="leading-relaxed">{rule}</li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Battle Rules */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Swords size={16} className="text-pink" />
            Battle Rules
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-2 text-sm text-text-secondary list-decimal pl-5">
            {BATTLE_RULES.map((rule, i) => (
              <li key={i} className="leading-relaxed">{rule}</li>
            ))}
          </ol>

          <div>
            <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">
              The following clauses apply
            </h4>
            <dl className="space-y-1.5">
              {CLAUSES.map(c => (
                <div key={c.name} className="grid grid-cols-[140px_1fr] gap-2 text-xs">
                  <dt className="font-medium text-text-primary">{c.name}</dt>
                  <dd className="text-text-secondary leading-relaxed">{c.description}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">
              Pokémon-specific bans
            </h4>
            <ul className="space-y-1 text-sm">
              {POKEMON_BANS.map(b => (
                <li key={b.pokemon} className="text-text-secondary">
                  <span className="font-medium text-text-primary">{b.move}</span> banned on{' '}
                  <span className="text-pink">{b.pokemon}</span>.
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Banned abilities/items/moves */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldOff size={16} className="text-loss" />
            Banned Abilities, Items &amp; Moves
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BanList title="Abilities" items={BANNED_ABILITIES} />
            <BanList title="Items" items={BANNED_ITEMS} />
            <BanList title="Moves" items={BANNED_MOVES} />
          </div>
        </CardContent>
      </Card>

      {/* Tera Captain bans */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star size={16} className="text-yellow-400" />
            Tera Captain Bans
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-muted mb-2">
            These Pokémon may be drafted but cannot be designated as Tera Captains.
          </p>
          <div className="flex flex-wrap gap-2">
            {TERA_BANNED.map(name => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-md bg-surface-overlay/60 border border-border-subtle px-2 py-1 text-xs text-text-secondary"
              >
                {name}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BanList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-1.5">
        {title}
      </h4>
      <ul className="space-y-0.5 text-xs text-text-secondary">
        {items.map(item => (
          <li key={item} className="font-medium">{item}</li>
        ))}
      </ul>
    </div>
  );
}
