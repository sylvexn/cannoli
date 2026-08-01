/**
 * Shared presentational bits for the Market / Trade Desk surfaces. Keeping the
 * trade-line rendering, status pills, legality meter and deadline badge in one
 * place means the composer, the block, and the activity panel all read the
 * same — no per-surface drift.
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowLeftRight, CalendarClock, Check, Clock, UserPlus } from 'lucide-react';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { useLeague } from '@/lib/league-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { Player, Trade } from '@/lib/types';
import {
  isTradeDeadlinePassed,
  pointDelta,
  tradePointSummary,
  validateTrade,
  type PendingByTeam,
  type ValidationIssue,
  type SidePoints,
} from '@/lib/trade-validation';

// Status config

export const TRADE_STATUS: Record<Trade['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-draw border-draw/30 bg-draw/10' },
  awaiting_admin: { label: 'Awaiting Admin', className: 'text-pink border-pink/30 bg-pink/10' },
  accepted: { label: 'Accepted', className: 'text-win border-win/30 bg-win/10' },
  rejected: { label: 'Rejected', className: 'text-loss border-loss/30 bg-loss/10' },
  expired: { label: 'Expired', className: 'text-text-muted border-border-subtle bg-surface-overlay/50' },
};

// Deadline badge

export function DeadlineBadge({ deadlineWeek, currentWeek }: { deadlineWeek: number; currentWeek: number }) {
  const passed = isTradeDeadlinePassed(currentWeek, deadlineWeek);
  // The deadline week itself is still tradeable, so week 7 of a week-7 deadline
  // is "last week to trade", not "0w left".
  const weeksLeft = deadlineWeek - currentWeek;
  if (passed) {
    return (
      <Badge variant="outline" className="text-loss border-loss/30 bg-loss/10 gap-1.5 px-2.5 py-1">
        <AlertTriangle size={12} />
        Deadline passed (Week {deadlineWeek})
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-neon border-neon/30 bg-neon/10 gap-1.5 px-2.5 py-1">
      <Clock size={12} />
      Trade deadline: Week {deadlineWeek}
      <span className="text-text-muted">
        · {weeksLeft <= 0 ? 'last week to trade' : `${weeksLeft}w left`}
      </span>
    </Badge>
  );
}

// Mon chip

/** Sprite + name link + optional tier badge. Sprite opens the side card. */
export function MonChip({
  name,
  tier,
  tone = 'neutral',
  size = 'xs',
}: {
  name: string;
  tier?: number;
  tone?: 'give' | 'get' | 'neutral';
  size?: 'xs' | 'sm';
}) {
  const { openSideCard } = usePokemonSideCard();
  const toneCls =
    tone === 'give' ? 'text-loss' : tone === 'get' ? 'text-win' : 'text-text-primary';
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <button
        type="button"
        onClick={() => openSideCard(name)}
        className="shrink-0 cursor-pointer"
        aria-label={`View ${name}`}
      >
        <PokemonSprite name={name} size={size} />
      </button>
      <Link
        to={pokemonRoute(name)}
        className={cn(
          'font-mono truncate hover:underline transition-colors hover:text-neon',
          size === 'sm' ? 'text-sm' : 'text-xs',
          toneCls,
        )}
      >
        {name}
      </Link>
      {tier != null && tier > 0 && <TierBadge points={tier} />}
    </span>
  );
}

// Trade summary (two sides)

function tierOf(team: Player | null, name: string): number {
  return team?.roster.find(m => m.name === name)?.tier ?? 0;
}

/**
 * The canonical "A gives [mons] ⇄ B gives [mons]" block. `recipient = null`
 * renders the free-agent pool. Used by the activity cards and the composer's
 * review strip so both read identically.
 */
export function TradeSummary({
  proposer,
  recipient,
  offering,
  requesting,
  className,
}: {
  proposer: Player | null;
  recipient: Player | null;
  offering: string[];
  requesting: string[];
  /** extra classes on the wrapper */
  className?: string;
}) {
  const isFreeAgent = recipient === null;
  return (
    <div className={cn('flex items-stretch gap-2', className)}>
      {/* Proposer side — what they send */}
      <div className="flex-1 min-w-0 space-y-1">
        {proposer && <TeamRow team={proposer} />}
        <div className="space-y-0.5">
          {offering.map(n => (
            <div key={n} className="flex">
              <MonChip name={n} tier={tierOf(proposer, n)} tone="give" />
            </div>
          ))}
          {offering.length === 0 && <span className="text-[11px] text-text-muted">—</span>}
        </div>
      </div>

      <div className="shrink-0 self-center text-text-muted">
        <ArrowLeftRight size={14} />
      </div>

      {/* Recipient side — what they send back */}
      <div className="flex-1 min-w-0 space-y-1">
        {isFreeAgent ? (
          <div className="flex items-center gap-1.5">
            <UserPlus size={12} className="text-neon" />
            <span className="text-[11px] font-medium text-neon">Free Agent Pool</span>
          </div>
        ) : (
          recipient && <TeamRow team={recipient} />
        )}
        <div className="space-y-0.5">
          {requesting.map(n => (
            <div key={n} className="flex">
              <MonChip name={n} tier={isFreeAgent ? undefined : tierOf(recipient, n)} tone="get" />
            </div>
          ))}
          {requesting.length === 0 && <span className="text-[11px] text-text-muted">—</span>}
        </div>
      </div>
    </div>
  );
}

function TeamRow({ team }: { team: Player }) {
  const league = useLeague();
  return (
    <Link
      to={`/league/${league.id}/teams/${team.id}`}
      className="flex items-center gap-1.5 group/team min-w-0"
    >
      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
      <span className="text-[11px] font-medium text-text-primary truncate group-hover/team:text-neon transition-colors">
        {team.teamName}
      </span>
    </Link>
  );
}

// Legality meter

/**
 * Live legality + points-impact panel for the composer. Self-contained:
 * computes everything from the two teams + selections via trade-validation.
 * Returns the issue list too (so the composer can gate Send on it).
 */
export function LegalityMeter({
  proposer,
  recipient,
  offering,
  requesting,
  pointCap,
  submitError,
  rosterSize,
  pending,
}: {
  proposer: Player;
  recipient: Player;
  offering: Set<string>;
  requesting: Set<string>;
  pointCap: number;
  submitError?: string | null;
  rosterSize?: number;
  /** Server-projected rosters for teams with approved-but-unapplied moves. */
  pending?: PendingByTeam;
}) {
  const league = useLeague();
  // Effective roster band — fall back to the draft rosterSize when unset, and
  // honor an explicit `rosterSize` prop override as the max.
  const effMax = rosterSize ?? league.season.maxRosterSize ?? league.season.rosterSize;
  const effMin = league.season.minRosterSize ?? league.season.rosterSize;
  const issues = validateTrade({ proposer, recipient, offering, requesting, pointCap, maxRosterSize: effMax, minRosterSize: effMin, pending });
  const pts = tradePointSummary(proposer, recipient, offering, requesting, pointCap, pending);
  const hasSelections = offering.size > 0 && requesting.size > 0;
  const isLegal = hasSelections && issues.length === 0;

  // Give/get point totals for unequal-swap awareness
  const givePts = pointDelta(proposer, offering, pending);
  const getPts = pointDelta(recipient, requesting, pending);
  const isUnequal = offering.size !== requesting.size;

  // Scheduled moves already baked into the totals above — say so, or the cap
  // math looks wrong next to the roster page.
  const scheduled = (pending?.[proposer.id]?.moves ?? 0) + (pending?.[recipient.id]?.moves ?? 0);

  return (
    <div className="space-y-2">
      {/* Give vs get point comparison — shown when sides differ in count or value */}
      {hasSelections && (givePts !== getPts || isUnequal) && (
        <div className="flex items-center gap-3 px-2.5 py-1.5 rounded-md bg-surface-overlay/40 border border-border-subtle text-[11px] font-mono">
          <span className="text-loss">Give {givePts}pt × {offering.size}</span>
          <span className="text-text-muted">vs</span>
          <span className="text-win">Get {getPts}pt × {requesting.size}</span>
          <span className={cn('ml-auto font-semibold', getPts > givePts ? 'text-win' : getPts < givePts ? 'text-loss' : 'text-text-muted')}>
            {getPts > givePts ? `+${getPts - givePts}` : getPts < givePts ? `−${givePts - getPts}` : 'even'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PointsCard team={proposer} pts={pts.proposer} cap={pointCap} />
        <PointsCard team={recipient} pts={pts.recipient} cap={pointCap} />
      </div>

      {scheduled > 0 && (
        <div className="flex items-start gap-2 px-2.5 py-1.5 rounded-md bg-surface-overlay/40 border border-border-subtle text-[11px] text-text-muted">
          <CalendarClock size={12} className="shrink-0 mt-0.5" />
          <span>
            Totals include {scheduled} approved move{scheduled === 1 ? '' : 's'} that
            {' '}land{scheduled === 1 ? 's' : ''} before this trade would.
          </span>
        </div>
      )}

      {hasSelections && issues.length > 0 && (
        <div className="rounded-md border border-loss/30 bg-loss/10 p-2.5 space-y-1">
          {issues.map((issue, i) => (
            <IssueRow key={i} issue={issue} />
          ))}
        </div>
      )}

      {isLegal && (
        <div className="rounded-md border border-win/30 bg-win/5 p-2.5 flex items-center gap-2 text-[11px] text-win">
          <Check size={14} className="shrink-0" />
          <span>Both rosters legal — point cap, mega limit, and species check pass.</span>
        </div>
      )}

      {submitError && (
        <div className="rounded-md border border-loss/30 bg-loss/10 p-2.5 flex items-start gap-2 text-[11px] text-loss">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{submitError}</span>
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  return (
    <div className="flex items-start gap-2 text-[11px] text-loss">
      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
      <span>{issue.message}</span>
    </div>
  );
}

function PointsCard({ team, pts, cap }: { team: Player; pts: SidePoints; cap: number }) {
  const deltaCls = pts.delta > 0 ? 'text-win' : pts.delta < 0 ? 'text-loss' : 'text-text-muted';
  return (
    <div
      className={cn(
        'rounded-md border p-2.5 space-y-1',
        pts.over ? 'border-loss/40 bg-loss/5' : 'border-border-subtle bg-surface-overlay/20',
      )}
    >
      <div className="flex items-center gap-1.5">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
        <span className="text-xs font-medium text-text-primary truncate">{team.teamAbbrev}</span>
        <span className={cn('text-[10px] font-mono ml-auto tabular-nums', deltaCls)}>
          {pts.delta > 0 ? '+' : ''}{pts.delta}
        </span>
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-text-muted">After</span>
        <span className={cn('font-mono tabular-nums font-semibold', pts.over ? 'text-loss' : 'text-text-primary')}>
          {pts.after} / {cap}
        </span>
      </div>
      {/* mini cap bar */}
      <div className="relative h-1 rounded-full bg-surface overflow-hidden">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all', pts.over ? 'bg-loss' : 'bg-neon/60')}
          style={{ width: `${Math.min(100, (pts.after / cap) * 100)}%` }}
        />
      </div>
    </div>
  );
}
