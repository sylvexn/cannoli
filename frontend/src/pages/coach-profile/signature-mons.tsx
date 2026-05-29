import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { EmptyState } from '@/components/empty-state';
import { pokemonRoute } from '@/lib/pokemon-route';
import { cn } from '@/lib/utils';
import type { SignatureMon } from './use-coach-extras';

interface SignatureMonsProps {
  mons: SignatureMon[];
  /** Accent color (coach primary) — used on the rank chip + hover ring. */
  accent: string;
  /** Whether the coach is in zero leagues at all — drives the empty copy. */
  inAnyLeague: boolean;
}

/**
 * Top-3 most-rostered Pokemon across the coach's currently-managed teams,
 * with sprite + "used in N" subtitle. Each card links to the pokemon detail
 * page. When the coach has no rosters yet, falls back to a themed empty
 * card explaining what'll fill the slot.
 */
export function SignatureMons({ mons, accent, inAnyLeague }: SignatureMonsProps) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3 flex items-center gap-1.5">
        <Sparkles size={12} style={{ color: accent }} />
        Signature mons
      </h2>
      {mons.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {mons.map((mon, idx) => (
            <SignatureMonCard
              key={mon.name}
              mon={mon}
              rank={idx + 1}
              accent={accent}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          variant="quiet"
          title={inAnyLeague ? 'Roster locked in soon.' : 'No rosters yet.'}
          subtitle={
            inAnyLeague
              ? "Once you draft this season, the mons you build around will show up here."
              : 'Join a league and start drafting — your most-played mons will live here.'
          }
          spriteSize="md"
          padding="sm"
        />
      )}
    </div>
  );
}

function SignatureMonCard({
  mon, rank, accent,
}: { mon: SignatureMon; rank: number; accent: string }) {
  return (
    <Link
      to={pokemonRoute(mon.name)}
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-lg border border-border-subtle/70 bg-surface-overlay/30 px-2 py-3',
        'hover:border-[var(--card-accent)] hover:bg-surface-overlay/60 transition-colors',
      )}
      style={{ ['--card-accent' as never]: accent }}
      title={`${mon.name} — used across ${mon.seasonsUsedIn} ${mon.seasonsUsedIn === 1 ? 'season' : 'seasons'}`}
    >
      {/* Rank chip — top-left, doesn't compete with sprite. Small and quiet. */}
      <span
        className="absolute top-1.5 left-1.5 text-[9px] font-mono font-bold tabular-nums px-1 py-px rounded"
        style={{ backgroundColor: `${accent}22`, color: accent }}
      >
        #{rank}
      </span>
      <PokemonSprite name={mon.name} size="md" shiny={mon.isShiny} />
      <div className="text-[11px] font-mono text-text-primary text-center leading-tight truncate w-full">
        {mon.name}
      </div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
        {mon.seasonsUsedIn === 1
          ? '1 season'
          : `${mon.seasonsUsedIn} seasons`}
      </div>
    </Link>
  );
}
