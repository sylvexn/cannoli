/**
 * Leaf sub-components extracted from standings.tsx to keep that file under the
 * 600-LOC standard. These are pure presentational pieces with simple props.
 */
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeftRight, UserPlus } from 'lucide-react';
import type { Player, Trade } from '@/lib/types';

export function TiebreakerBadge({ tiebreaker }: { tiebreaker: Player['tiebreaker'] }) {
  if (!tiebreaker) return null;
  const RULE_LABEL: Record<string, string> = {
    h2h: 'H2H',
    diff: 'Diff',
    kills: 'PF',
    id: '—',
  };
  const RULE_DESC: Record<string, string> = {
    h2h: 'Head-to-head record vs tied teams',
    diff: 'Point differential',
    kills: 'Total kills (points for)',
    id: 'Stable tiebreak (team id)',
  };
  const label = RULE_LABEL[tiebreaker.rule] ?? tiebreaker.rule;
  const desc = RULE_DESC[tiebreaker.rule] ?? '';
  // Format value differently per rule
  let valueStr: string;
  if (tiebreaker.rule === 'diff') {
    const v = Number(tiebreaker.value);
    valueStr = v > 0 ? `+${v}` : String(v);
  } else if (tiebreaker.rule === 'h2h') {
    valueStr = String(tiebreaker.value);
  } else {
    valueStr = String(tiebreaker.value);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={e => e.stopPropagation()}
          className="hidden md:inline-flex items-center gap-0.5 shrink-0 px-2 py-0.5 rounded-full border border-border-subtle bg-surface-overlay/40 text-[9px] font-mono text-text-muted cursor-help"
        >
          <span className="font-semibold text-text-secondary">{label}</span>
          <span className="tabular-nums">{valueStr}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[220px] text-xs">
        <div className="font-medium text-text-primary mb-0.5">Tiebreaker: {label}</div>
        <div className="text-text-muted">{desc}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function TradeHistoryRow({ trade, teamId }: { trade: Trade; teamId: string }) {
  const isFreeAgent = trade.recipient === 'pool';
  const isProposer = trade.proposer === teamId;
  const sent = isProposer ? trade.offering : trade.requesting;
  const received = isProposer ? trade.requesting : trade.offering;

  return (
    <div className="flex items-center gap-2 text-[10px] text-text-secondary py-0.5">
      <Badge variant="outline" className="text-[9px] px-1 py-0 border-border-subtle shrink-0">
        W{trade.week}
      </Badge>
      {isFreeAgent ? (
        <UserPlus size={10} className="text-neon shrink-0" />
      ) : (
        <ArrowLeftRight size={10} className="text-text-muted shrink-0" />
      )}
      <span className="truncate">
        <span className="text-win">+{received.join(', ')}</span>
        <span className="text-text-muted mx-1">/</span>
        <span className="text-loss">-{sent.join(', ')}</span>
      </span>
    </div>
  );
}
