/**
 * Trade Activity panel — reorganized around "what needs the viewer's action".
 *
 * The old block dumped every league trade into one undifferentiated list. This
 * splits it into three stacked bands, prioritized top → bottom:
 *   1. NEEDS YOU   — pending trades where the viewer is the recipient and can
 *                    act (Accept / Reject / Counter). The prominent band.
 *   2. YOUR OFFERS — pending / awaiting_admin trades the viewer proposed and is
 *                    waiting on (Withdraw). Excludes anything in NEEDS YOU.
 *   3. HISTORY     — resolved trades, week-grouped, behind a Collapsible
 *                    (delegated to TradeHistory).
 *
 * Card rendering (TradeCard) reuses TradeSummary + TRADE_STATUS from
 * trade-bits so the activity panel reads identically to the composer.
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Check, Repeat, Send, X, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLeagueData } from '@/lib/league-data-context';
import { canManageTeam } from '@/lib/permissions';
import { useFormatDate } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { toast } from 'sonner';
import type { Player, Trade } from '@/lib/types';
import { TRADE_STATUS, TradeSummary } from '@/pages/market/trade-bits';
import { TradeHistory } from '@/pages/market/trade-history';

export interface TradeActivityProps {
  /** Merged list, all statuses. */
  trades: Trade[];
  /** Reload trades after accept / reject / withdraw. */
  onChanged: () => void;
  /** Parent opens the composer in counter mode. */
  onCounter: (trade: Trade) => void;
  /** Viewer's team; undefined if they manage none here. */
  actingTeam: Player | undefined;
}

type Section = 'needs-you' | 'your-offers';

export function TradeActivity({
  trades,
  onChanged,
  onCounter,
}: TradeActivityProps): React.ReactElement {
  const { players } = useLeagueData();
  const { user } = useAuth();

  const playerMap = useMemo(
    () => new Map<string, Player>(players.map(p => [p.id, p])),
    [players],
  );

  const sorted = useMemo(
    () => [...trades].sort((a, b) => b.week - a.week),
    [trades],
  );

  // 1. NEEDS YOU — pending, viewer is the recipient and can act.
  const needsYou = useMemo(
    () =>
      sorted.filter(t => {
        if (t.status !== 'pending') return false;
        if (t.recipient === 'pool') return false;
        return canManageTeam(user, playerMap.get(t.recipient) ?? null);
      }),
    [sorted, user, playerMap],
  );
  const needsYouIds = useMemo(() => new Set(needsYou.map(t => t.id)), [needsYou]);

  // 2. YOUR OFFERS — pending / awaiting_admin the viewer proposed, not already
  //    surfaced in NEEDS YOU (a viewer who manages both sides only sees it once).
  const yourOffers = useMemo(
    () =>
      sorted.filter(t => {
        if (t.status !== 'pending' && t.status !== 'awaiting_admin') return false;
        if (needsYouIds.has(t.id)) return false;
        return canManageTeam(user, playerMap.get(t.proposer) ?? null);
      }),
    [sorted, user, playerMap, needsYouIds],
  );

  // 3. HISTORY — resolved trades.
  const history = useMemo(
    () => sorted.filter(t => t.status === 'accepted' || t.status === 'rejected'),
    [sorted],
  );

  const hasAnything = needsYou.length > 0 || yourOffers.length > 0 || history.length > 0;

  return (
    <div className="space-y-4">
      {/* === NEEDS YOU === */}
      {needsYou.length > 0 && (
        <section className="rounded-lg border border-draw/40 bg-draw/[0.04] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-draw/20 bg-draw/10">
            <Zap size={15} className="text-draw shrink-0" />
            <span className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary">
              Needs you
            </span>
            <Badge variant="outline" className="text-[11px] px-1.5 py-0 text-draw border-draw/40 bg-draw/10">
              {needsYou.length}
            </Badge>
          </div>
          <div className="p-3 space-y-2">
            {needsYou.map(t => (
              <TradeCard
                key={t.id}
                trade={t}
                section="needs-you"
                playerMap={playerMap}
                onChanged={onChanged}
                onCounter={onCounter}
              />
            ))}
          </div>
        </section>
      )}

      {/* === YOUR OFFERS === */}
      {yourOffers.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Send size={14} className="text-text-muted shrink-0" />
            <span className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary">
              Your offers
            </span>
            <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-border-subtle text-text-muted">
              {yourOffers.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {yourOffers.map(t => (
              <TradeCard
                key={t.id}
                trade={t}
                section="your-offers"
                playerMap={playerMap}
                onChanged={onChanged}
                onCounter={onCounter}
              />
            ))}
          </div>
        </section>
      )}

      {/* === HISTORY === */}
      <TradeHistory trades={history} playerMap={playerMap} />

      {!hasAnything && (
        <div className="rounded-lg border border-border-default bg-surface-raised/40 px-4 py-8 text-center">
          <p className="text-sm text-text-secondary">No trade activity yet.</p>
          <p className="text-xs text-text-muted mt-1">Proposals you send or receive will show up here.</p>
        </div>
      )}
    </div>
  );
}

// Trade card

function TradeCard({
  trade,
  section,
  playerMap,
  onChanged,
  onCounter,
}: {
  trade: Trade;
  section: Section;
  playerMap: Map<string, Player>;
  onChanged: () => void;
  onCounter: (trade: Trade) => void;
}) {
  const fmtDate = useFormatDate();

  const isFreeAgent = trade.recipient === 'pool';
  const proposer = playerMap.get(trade.proposer) ?? null;
  const recipient = isFreeAgent ? null : playerMap.get(trade.recipient) ?? null;

  // Optimistic status — the card reflects the action before the reload lands.
  const [localStatus, setLocalStatus] = useState<Trade['status'] | null>(null);
  const status = localStatus ?? trade.status;
  const statusCfg = TRADE_STATUS[status];

  const [submitting, setSubmitting] = useState<'accept' | 'reject' | 'withdraw' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Stale-listing check: any offered mon no longer on the proposer's roster, or
  // any requested mon no longer on the recipient's roster, while the proposal is
  // still live. Cheap render-side pre-validation mirroring the backend gate.
  const staleNames = useMemo(() => {
    if (status !== 'pending' && status !== 'awaiting_admin') return [];
    const out: string[] = [];
    for (const n of trade.offering) {
      if (!proposer?.roster.some(m => m.name === n)) out.push(`${proposer?.teamAbbrev ?? 'proposer'} no longer has ${n}`);
    }
    if (!isFreeAgent) {
      for (const n of trade.requesting) {
        if (!recipient?.roster.some(m => m.name === n)) out.push(`${recipient?.teamAbbrev ?? 'recipient'} no longer has ${n}`);
      }
    }
    return out;
  }, [status, trade.offering, trade.requesting, proposer, recipient, isFreeAgent]);

  // Once a local action lands, the card is resolved — drop the action footer.
  const resolved = localStatus != null;

  async function handleAccept() {
    setSubmitting('accept');
    try {
      await api.respondToTrade(trade.id, 'accept');
      setLocalStatus('awaiting_admin');
      toast.success('Sent for admin approval');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function confirmReject() {
    const reason = rejectReason.trim();
    setSubmitting('reject');
    try {
      await api.respondToTrade(trade.id, 'reject', reason || undefined);
      setLocalStatus('rejected');
      toast.success('Trade rejected');
      setRejectOpen(false);
      setRejectReason('');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleWithdraw() {
    setSubmitting('withdraw');
    try {
      await api.withdrawTrade(trade.id);
      setLocalStatus('rejected');
      toast.success('Trade withdrawn');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(null);
    }
  }

  const pending = status === 'pending' || status === 'awaiting_admin';

  return (
    <div
      className={cn(
        'rounded-lg border bg-surface-raised/50 overflow-hidden',
        pending ? 'border-draw/20' : 'border-border-default',
      )}
    >
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/20 border-b border-border-subtle">
        <span className="text-[11px] font-mono text-text-muted">W{trade.week}</span>
        <Badge variant="outline" className={cn('text-[11px] px-1.5 py-0', statusCfg.className)}>
          {statusCfg.label}
        </Badge>
        {isFreeAgent && (
          <Badge variant="outline" className="text-[11px] px-1.5 py-0 text-neon border-neon/30 bg-neon/10">
            FA
          </Badge>
        )}
        {staleNames.length > 0 && (
          <Badge
            variant="outline"
            className="text-[11px] px-1.5 py-0 text-loss border-loss/40 bg-loss/10 gap-0.5"
            title={staleNames.join(' · ')}
          >
            <AlertTriangle size={11} />
            Stale
          </Badge>
        )}
        <span className="text-[11px] text-text-muted ml-auto">
          {trade.proposedAt ? fmtDate(trade.proposedAt) : ''}
        </span>
      </div>

      {/* Trade body — reuse the canonical summary */}
      <div className="px-3 py-2.5">
        <TradeSummary
          proposer={proposer}
          recipient={recipient}
          offering={trade.offering}
          requesting={trade.requesting}
        />
      </div>

      {/* Actions */}
      {!resolved && section === 'needs-you' && (
        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-border-subtle bg-surface-overlay/20">
          <Button
            size="xs"
            variant="outline"
            onClick={() => { setRejectReason(''); setRejectOpen(true); }}
            disabled={submitting !== null}
            className="text-loss border-loss/30 hover:bg-loss/10"
          >
            <X size={12} />
            Reject
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onCounter(trade)}
            disabled={submitting !== null}
            className="text-draw border-draw/30 hover:bg-draw/10"
          >
            <Repeat size={12} />
            Counter
          </Button>
          <Button
            size="xs"
            onClick={handleAccept}
            disabled={submitting !== null}
            className="bg-win text-surface-base hover:bg-win/90"
          >
            <Check size={12} />
            {submitting === 'accept' ? 'Accepting…' : 'Accept'}
          </Button>
        </div>
      )}

      {!resolved && section === 'your-offers' && (
        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-border-subtle bg-surface-overlay/20">
          <Button
            size="xs"
            variant="outline"
            onClick={handleWithdraw}
            disabled={submitting !== null}
            className="text-loss border-loss/30 hover:bg-loss/10"
          >
            <X size={12} />
            {submitting === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
          </Button>
        </div>
      )}

      {/* Reject reason dialog */}
      <Dialog open={rejectOpen} onOpenChange={v => { if (!v && submitting !== 'reject') setRejectOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject trade</DialogTitle>
            <DialogDescription>
              Optionally explain why so the proposer can adjust.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Reason (optional)"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={submitting === 'reject'}>
              Cancel
            </Button>
            <Button
              onClick={confirmReject}
              disabled={submitting === 'reject'}
              className="bg-loss text-surface-base hover:bg-loss/90"
            >
              <X size={14} />
              {submitting === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
