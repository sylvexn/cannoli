import { useState } from 'react';
import type { Player, Trade } from '@/lib/types';
import { useLeagueData } from '@/lib/league-data-context';
import { useAuth } from '@/lib/auth-context';
import { canManageTeam } from '@/lib/permissions';
import { api } from '@/lib/api';
import { TeamLink } from '@/components/team-link';
import { useLeague } from '@/lib/league-context';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ArrowLeftRight, UserPlus, Check, X, AlertTriangle, Repeat } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { useFormatDate } from '@/lib/format';
import { toast } from 'sonner';

const statusConfig: Record<Trade['status'], { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'text-draw border-draw/30 bg-draw/10' },
  awaiting_admin: { label: 'Awaiting Admin', className: 'text-pink border-pink/30 bg-pink/10' },
  accepted: { label: 'Accepted', className: 'text-win border-win/30 bg-win/10' },
  rejected: { label: 'Rejected', className: 'text-loss border-loss/30 bg-loss/10' },
  expired: { label: 'Expired', className: 'text-text-muted border-border-subtle bg-surface-overlay/50' },
};

/** Compact horizontal trade card for proposals */
export function CompactTradeCard({
  trade,
  onResponded,
  onCounter,
}: {
  trade: Trade;
  onResponded?: () => void;
  /** Open the propose dialog pre-filled with the counter-proposal payload. */
  onCounter?: (trade: Trade) => void;
}) {
  const { players } = useLeagueData();
  const league = useLeague();
  const { user } = useAuth();
  const fmtDate = useFormatDate();
  const { openSideCard } = usePokemonSideCard();
  const playerMap = new Map<string, Player>(players.map(p => [p.id, p]));
  const proposer = playerMap.get(trade.proposer);
  const isFreeAgent = trade.recipient === 'pool';
  const recipient = isFreeAgent ? null : playerMap.get(trade.recipient);

  // Counterparty action eligibility: pending trade + current user can
  // manage the recipient team (owner OR staff). Staff bypass ownership
  // gates per backend isStaff() — the UI must mirror that.
  const canRespond = !!(
    trade.status === 'pending' &&
    canManageTeam(user, recipient)
  );

  // Proposer-side withdraw eligibility: pending/awaiting_admin + current
  // user can manage the proposer team (owner OR staff).
  const canWithdraw = !!(
    (trade.status === 'pending' || trade.status === 'awaiting_admin') &&
    canManageTeam(user, proposer)
  );

  // Stale-listing detection: render-side cheap pre-validation. Flags any
  // pokemon in offering/requesting that the listed team no longer owns
  // (e.g. they traded it away after this proposal landed).
  function isStale(name: string, teamId: string): boolean {
    const team = playerMap.get(teamId);
    if (!team) return true;
    return !team.roster.some(m => m.name === name);
  }
  const staleOffering = trade.offering.filter(n => isStale(n, trade.proposer));
  const staleRequesting = !isFreeAgent
    ? trade.requesting.filter(n => isStale(n, trade.recipient))
    : [];
  const isStaleProposal = (
    (trade.status === 'pending' || trade.status === 'awaiting_admin') &&
    (staleOffering.length > 0 || staleRequesting.length > 0)
  );

  const [submitting, setSubmitting] = useState<'accept' | 'reject' | 'withdraw' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // Track local optimistic status so the card updates immediately
  const [localStatus, setLocalStatus] = useState<Trade['status'] | null>(null);
  const displayStatus = localStatus ?? trade.status;
  const displayStatusConfig = statusConfig[displayStatus];

  function findTier(pokemonName: string, teamId: string): number {
    return playerMap.get(teamId)?.roster.find(m => m.name === pokemonName)?.tier ?? 0;
  }

  async function handleAccept() {
    setSubmitting('accept');
    try {
      await api.respondToTrade(trade.id, 'accept');
      setLocalStatus('awaiting_admin');
      toast.success('Sent for admin approval');
      onResponded?.();
    } catch (err: any) {
      toast.error(err.message);
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
      onResponded?.();
    } catch (err: any) {
      toast.error(err.message);
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
      onResponded?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className={cn(
      'rounded-lg border bg-surface-raised/50 overflow-hidden',
      displayStatus === 'pending' ? 'border-draw/20' : 'border-border-default',
    )}>
      {/* Header strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/20 border-b border-border-subtle/30">
        <span className="text-[10px] font-mono text-text-muted">W{trade.week}</span>
        <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', displayStatusConfig.className)}>
          {displayStatusConfig.label}
        </Badge>
        {isFreeAgent && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-neon border-neon/30 bg-neon/10">
            FA
          </Badge>
        )}
        {isStaleProposal && (
          <Badge
            variant="outline"
            className="text-[9px] px-1.5 py-0 text-loss border-loss/40 bg-loss/10 gap-0.5"
            title={[
              ...staleOffering.map(n => `${proposer?.teamAbbrev ?? 'proposer'} no longer has ${n}`),
              ...staleRequesting.map(n => `${recipient?.teamAbbrev ?? 'recipient'} no longer has ${n}`),
            ].join(' · ')}
          >
            <AlertTriangle size={9} />
            Stale
          </Badge>
        )}
        <span className="text-[9px] text-text-muted ml-auto">
          {trade.proposedAt ? fmtDate(trade.proposedAt) : ''}
        </span>
      </div>

      {/* Trade body */}
      <div className="px-3 py-2 flex items-center gap-2">
        {/* Proposer */}
        <div className="flex-1 min-w-0">
          {proposer && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <TeamLink
                team={{
                  leagueId: league.id,
                  teamId: proposer.id,
                  teamName: proposer.teamName,
                  teamAbbrev: proposer.teamAbbrev,
                  teamColor: proposer.teamColor,
                  record: proposer.record,
                }}
                logoSize="sm"
              >
                <span className="text-[11px] font-medium text-text-primary hover:text-neon transition-colors truncate">
                  {proposer.teamName}
                </span>
              </TeamLink>
            </div>
          )}
          <div className="space-y-0.5">
            {trade.offering.map(name => (
              <div key={name} className="flex items-center gap-1.5 hover:bg-surface-overlay/30 rounded px-0.5 -mx-0.5 transition-colors">
                <button type="button" onClick={() => openSideCard(name)} className="shrink-0 cursor-pointer"><PokemonSprite name={name} size="xs" /></button>
                <Link to={pokemonRoute(name)} className="text-xs font-mono text-text-primary truncate hover:text-neon hover:underline transition-colors">{name}</Link>
                {findTier(name, trade.proposer) > 0 && <TierBadge points={findTier(name, trade.proposer)} />}
              </div>
            ))}
          </div>
        </div>

        {/* Arrow */}
        <div className="shrink-0 flex flex-col items-center text-text-muted">
          <ArrowLeftRight size={14} />
        </div>

        {/* Recipient */}
        <div className="flex-1 min-w-0">
          {isFreeAgent ? (
            <div className="flex items-center gap-1.5 mb-1.5">
              <UserPlus size={12} className="text-neon" />
              <span className="text-[11px] font-medium text-neon">Free Agent Pool</span>
            </div>
          ) : recipient ? (
            <div className="flex items-center gap-1.5 mb-1.5">
              <TeamLink
                team={{
                  leagueId: league.id,
                  teamId: recipient.id,
                  teamName: recipient.teamName,
                  teamAbbrev: recipient.teamAbbrev,
                  teamColor: recipient.teamColor,
                  record: recipient.record,
                }}
                logoSize="sm"
              >
                <span className="text-[11px] font-medium text-text-primary hover:text-neon transition-colors truncate">
                  {recipient.teamName}
                </span>
              </TeamLink>
            </div>
          ) : null}
          <div className="space-y-0.5">
            {trade.requesting.map(name => (
              <div key={name} className="flex items-center gap-1.5 hover:bg-surface-overlay/30 rounded px-0.5 -mx-0.5 transition-colors">
                <button type="button" onClick={() => openSideCard(name)} className="shrink-0 cursor-pointer"><PokemonSprite name={name} size="xs" /></button>
                <Link to={pokemonRoute(name)} className="text-xs font-mono text-text-primary truncate hover:text-neon hover:underline transition-colors">{name}</Link>
                {!isFreeAgent && findTier(name, trade.recipient) > 0 && (
                  <TierBadge points={findTier(name, trade.recipient)} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Counterparty actions */}
      {canRespond && localStatus == null && (
        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-border-subtle/30 bg-surface-overlay/20">
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
          {onCounter && (
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
          )}
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

      {/* Proposer-side withdraw */}
      {canWithdraw && localStatus == null && (
        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-t border-border-subtle/30 bg-surface-overlay/20">
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
