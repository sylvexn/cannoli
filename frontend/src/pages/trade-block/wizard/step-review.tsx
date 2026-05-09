import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, ArrowRightLeft, Check } from 'lucide-react';
import type { Player } from '@/lib/types';
import { pointDelta, type ValidationIssue } from './validation';
import { cn } from '@/lib/utils';

interface ReviewStepProps {
  proposer: Player | null;
  recipient: Player | null;
  offering: Set<string>;
  requesting: Set<string>;
  pointCap: number;
  validationIssues: ValidationIssue[];
  submitError: string | null;
}

/**
 * Step 4 — final review. Shows points delta on each side, mega/cap validation
 * messaging, and any submit error from the backend (so the wizard surfaces the
 * trade-deadline rejection without losing context).
 */
export function ReviewStep({
  proposer,
  recipient,
  offering,
  requesting,
  pointCap,
  validationIssues,
  submitError,
}: ReviewStepProps) {
  if (!proposer || !recipient) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle p-6 text-center text-xs text-text-muted">
        Pick teams and Pokemon first.
      </div>
    );
  }

  const offeringPts = pointDelta(proposer, offering);
  const requestingPts = pointDelta(recipient, requesting);
  const proposerTotal = proposer.roster.reduce((s, m) => s + (m.tier || 0), 0);
  const recipientTotal = recipient.roster.reduce((s, m) => s + (m.tier || 0), 0);
  const proposerPost = proposerTotal - offeringPts + requestingPts;
  const recipientPost = recipientTotal - requestingPts + offeringPts;

  return (
    <div className="space-y-4">
      {/* Trade summary card */}
      <div className="rounded-md border border-border-subtle bg-surface-overlay/30 p-3 space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <SideSummary
            team={proposer}
            mons={[...offering].map(n => proposer.roster.find(m => m.name === n)).filter(Boolean) as Player['roster']}
            label="Offering"
            color="text-loss"
          />
          <ArrowRightLeft size={18} className="text-text-muted shrink-0 mx-auto" />
          <SideSummary
            team={recipient}
            mons={[...requesting].map(n => recipient.roster.find(m => m.name === n)).filter(Boolean) as Player['roster']}
            label="Requesting"
            color="text-win"
            align="right"
          />
        </div>
      </div>

      {/* Points delta */}
      <div className="grid grid-cols-2 gap-3">
        <PointsCard
          team={proposer}
          before={proposerTotal}
          after={proposerPost}
          delta={requestingPts - offeringPts}
          cap={pointCap}
        />
        <PointsCard
          team={recipient}
          before={recipientTotal}
          after={recipientPost}
          delta={offeringPts - requestingPts}
          cap={pointCap}
        />
      </div>

      {/* Validation */}
      {validationIssues.length > 0 ? (
        <div className="rounded-md border border-loss/30 bg-loss/10 p-3 space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-loss font-semibold mb-1">
            Cannot submit — fix the following:
          </div>
          {validationIssues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-loss">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-win/30 bg-win/5 p-3 flex items-center gap-2 text-[11px] text-win">
          <Check size={14} />
          <span>Trade is legal — point cap, mega limit, and species check pass.</span>
        </div>
      )}

      {/* Submit-time backend error (e.g. trade deadline passed) */}
      {submitError && (
        <div className="rounded-md border border-loss/30 bg-loss/10 p-3">
          <div className="flex items-start gap-2 text-[11px] text-loss">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SideSummary({
  team, mons, label, color, align = 'left',
}: {
  team: Player;
  mons: Player['roster'];
  label: string;
  color: string;
  align?: 'left' | 'right';
}) {
  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <div className={cn('flex items-center gap-2 mb-2', align === 'right' && 'justify-end')}>
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{team.teamAbbrev}</span>
        <span className={cn('text-[10px] font-mono uppercase tracking-wider font-semibold', color)}>{label}</span>
      </div>
      <div className={cn('flex items-center gap-1 flex-wrap', align === 'right' && 'justify-end')}>
        {mons.length === 0 && <span className="text-[11px] text-text-muted">Nothing selected</span>}
        {mons.map(m => (
          <Badge key={m.name} variant="outline" className={cn('text-[10px] gap-1 px-1.5', color, color.replace('text-', 'border-') + '/30')}>
            <PokemonSprite name={m.name} size="xs" />
            {m.name}
            <TierBadge points={m.tier} />
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PointsCard({
  team, before, after, delta, cap,
}: {
  team: Player;
  before: number;
  after: number;
  delta: number;
  cap: number;
}) {
  const deltaCls = delta > 0 ? 'text-win' : delta < 0 ? 'text-loss' : 'text-text-muted';
  const overCap = after > cap;
  return (
    <div className={cn('rounded-md border p-3 space-y-1', overCap ? 'border-loss/30 bg-loss/5' : 'border-border-subtle bg-surface-overlay/20')}>
      <div className="flex items-center gap-2">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" logoPath={team.logoPath} />
        <span className="text-xs font-medium text-text-primary truncate">{team.teamAbbrev}</span>
        <span className={cn('text-[10px] font-mono ml-auto tabular-nums', deltaCls)}>
          {delta > 0 ? '+' : ''}{delta} pts
        </span>
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-text-muted">Before</span>
        <span className="font-mono tabular-nums text-text-secondary">{before}</span>
      </div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-text-muted">After</span>
        <span className={cn('font-mono tabular-nums font-semibold', overCap ? 'text-loss' : 'text-text-primary')}>
          {after} / {cap}
        </span>
      </div>
    </div>
  );
}
