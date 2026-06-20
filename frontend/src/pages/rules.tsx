import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollText, Swords, Star, ShieldOff } from 'lucide-react';
import { getTeraBanned, DEFAULT_FORMAT, type CostFormat } from '@/data/tier-list';
import { cn } from '@/lib/utils';

const FORMAT_LABELS: Record<CostFormat, string> = {
  natdexplus: 'NatDex+ (Ruby/Sapphire)',
  natdex: 'NatDex (Emerald)',
};

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
  'The top 8 teams in each league qualify for the playoff bracket.',
  'Forfeits are handled case-by-case by admin review — there is no automatic double-forfeit. If a match cannot be completed by the week\'s deadline, contact staff and the result will be adjudicated.',
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
];

const BANNED_ABILITIES = ['Shadow Tag', 'Arena Trap', 'Moody'];
const BANNED_ITEMS = ['Bright Powder', 'Lax Incense', 'Razor Fang', "King's Rock"];
const BANNED_MOVES = [
  'Acupressure', 'Baton Pass', 'Flatter', 'Frustration', 'Hidden Power',
  'Last Respects', 'Pursuit', 'Return', 'Revival Blessing', 'Shed Tail', 'Swagger',
  'Take Heart',
];

export function RulesPage() {
  const [format, setFormat] = useState<CostFormat>(DEFAULT_FORMAT);
  const teraBanned = getTeraBanned(format);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
          <span className="text-pink">League</span>{' '}
          <span className="text-text-primary">Rules</span>
        </h1>
        <p className="text-xs text-text-muted">Cannoli draft and battle rules — read before drafting.</p>
      </div>

      {/* Three-column row: Draft / Battle / Bans */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        {/* Draft Rules */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ScrollText size={14} className="text-neon" />
              Draft Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <ol className="space-y-1 text-xs text-text-secondary list-decimal pl-4 leading-snug">
              {DRAFT_RULES.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* Battle Rules */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Swords size={14} className="text-pink" />
              Battle Rules
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-3">
            <ol className="space-y-1 text-xs text-text-secondary list-decimal pl-4 leading-snug">
              {BATTLE_RULES.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ol>

            <div>
              <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                Clauses
              </h4>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] leading-snug">
                {CLAUSES.map(c => (
                  <div key={c.name}>
                    <dt className="inline font-medium text-text-primary">{c.name}:</dt>{' '}
                    <dd className="inline text-text-secondary">{c.description}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">
                Pokémon-specific bans
              </h4>
              <ul className="space-y-0.5 text-xs">
                {POKEMON_BANS.map(b => (
                  <li key={b.pokemon} className="text-text-secondary leading-snug">
                    <span className="font-medium text-text-primary">{b.move}</span> on{' '}
                    <span className="text-pink">{b.pokemon}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Banned Abilities / Items / Moves */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldOff size={14} className="text-loss" />
              Banned Abilities, Items &amp; Moves
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-2">
              <BanList title="Abilities" items={BANNED_ABILITIES} />
              <BanList title="Items" items={BANNED_ITEMS} />
              <BanList title="Moves" items={BANNED_MOVES} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tera Captain bans — full width strip */}
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Star size={14} className="text-yellow-400" />
            Tera Captain Bans
            <span className="text-[10px] font-mono text-text-muted normal-case tracking-normal">
              draftable, but not as captain
            </span>
            {/* Format toggle — ban lists differ between NatDex and NatDex+ */}
            <div className="ml-auto flex items-center gap-px rounded border border-border-subtle overflow-hidden">
              {(['natdexplus', 'natdex'] as CostFormat[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn(
                    'px-2.5 py-0.5 text-[10px] font-medium transition-colors',
                    format === f
                      ? 'bg-surface-overlay text-text-primary'
                      : 'text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
                  )}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-wrap gap-1.5">
            {teraBanned.map(name => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-md bg-surface-overlay/60 border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary"
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
      <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-0.5">
        {title}
      </h4>
      <p className="text-[11px] text-text-secondary leading-snug">
        {items.join(' · ')}
      </p>
    </div>
  );
}
