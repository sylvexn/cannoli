import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { Check, X, ArrowLeftRight, Clock } from 'lucide-react';
import { formatTimestamp } from '@/lib/format';

interface AdminTrade {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  week: number;
  proposer: string;
  recipient: string;
  offering: string[];
  requesting: string[];
  proposedAt: string;
  status: 'pending' | 'awaiting_admin' | 'accepted' | 'rejected' | 'expired';
  rejectReason?: string | null;
}

export function AdminTrades() {
  const { leagues } = useAppData();
  const [tradeList, setTradeList] = useState<AdminTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<AdminTrade | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (leagues.length === 0) return;
    Promise.all(
      leagues.map(l =>
        api.getTrades(l.id).then(trades => trades.map(t => ({
          id: t.id,
          leagueId: t.leagueId,
          leagueName: l.name.replace(' League', ''),
          leagueColor: l.color,
          week: t.week,
          proposer: t.proposerId,
          recipient: t.recipientId,
          offering: t.offering,
          requesting: t.requesting,
          proposedAt: t.proposedAt || '',
          status: t.status,
          rejectReason: t.rejectReason,
        })))
      )
    ).then(results => {
      setTradeList(results.flat());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagues]);

  const pending = tradeList.filter(t => t.status === 'pending' || t.status === 'awaiting_admin');
  const resolved = tradeList.filter(t => t.status !== 'pending' && t.status !== 'awaiting_admin');

  async function handleApprove(id: string) {
    try {
      await api.approveTrade(id);
      setTradeList(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'accepted' as const } : t
      ));
      toast.success('Trade approved');
    } catch (err: any) { toast.error(err.message); }
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const id = rejectTarget.id;
    const reason = rejectReason.trim();
    try {
      await api.rejectTrade(id, reason || undefined);
      setTradeList(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'rejected' as const, rejectReason: reason || null } : t
      ));
      toast.success('Trade rejected');
      setRejectTarget(null);
      setRejectReason('');
    } catch (err: any) { toast.error(err.message); }
  }

  if (loading) {
    return <LoadingSprite label="Loading trades..." />;
  }

  return (
    <div className="space-y-6">
      {/* Pending Approval */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary">Pending Approval</h3>
          {pending.length > 0 && (
            <Badge variant="outline" className="border-draw/30 text-draw bg-draw/10">
              {pending.length}
            </Badge>
          )}
        </div>

        {pending.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-text-muted text-sm">
              No trades pending approval
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pending.map(trade => (
              <TradeApprovalCard
                key={trade.id}
                trade={trade}
                onApprove={() => handleApprove(trade.id)}
                onReject={() => { setRejectTarget(trade); setRejectReason(''); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Resolved */}
      {resolved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-primary">Recent Decisions</h3>
          <div className="space-y-2">
            {resolved.map(trade => (
              <TradeApprovalCard key={trade.id} trade={trade} />
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={v => { if (!v) setRejectTarget(null); }}>
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
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button onClick={confirmReject} className="bg-loss text-surface-base hover:bg-loss/90">
              <X size={14} /> Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TradeApprovalCard({
  trade,
  onApprove,
  onReject,
}: {
  trade: AdminTrade;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const isActive = trade.status === 'pending' || trade.status === 'awaiting_admin';

  return (
    <Card className={!isActive ? 'opacity-60' : undefined}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start gap-3">
          {/* League + week */}
          <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
            <Badge
              variant="outline"
              className="text-[10px] px-1.5"
              style={{
                borderColor: `${trade.leagueColor}40`,
                color: trade.leagueColor,
                backgroundColor: `${trade.leagueColor}10`,
              }}
            >
              {trade.leagueName}
            </Badge>
            <span className="text-[10px] text-text-muted">W{trade.week}</span>
          </div>

          {/* Trade details */}
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-text-primary">{trade.proposer}</span>
              <ArrowLeftRight size={12} className="text-text-muted shrink-0" />
              <span className="font-medium text-text-primary">{trade.recipient}</span>
              {trade.status === 'awaiting_admin' && (
                <Badge variant="outline" className="text-[10px] border-draw/30 text-draw bg-draw/10">
                  awaiting admin
                </Badge>
              )}
            </div>
            <div className="flex gap-4 text-xs">
              <div>
                <span className="text-text-muted">Sends: </span>
                <span className="text-text-secondary">{trade.offering.join(', ')}</span>
              </div>
              <div>
                <span className="text-text-muted">Receives: </span>
                <span className="text-text-secondary">{trade.requesting.join(', ')}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <Clock size={10} />
              {formatTimestamp(trade.proposedAt)}
            </div>
            {trade.rejectReason && (
              <div className="text-[11px] text-loss/80 italic">
                Reason: {trade.rejectReason}
              </div>
            )}
          </div>

          {/* Actions / Status */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isActive ? (
              <>
                <Button size="xs" variant="outline" onClick={onReject} className="text-loss border-loss/30 hover:bg-loss/10">
                  <X size={12} />
                  Reject
                </Button>
                <Button size="xs" onClick={onApprove} className="bg-win text-surface-base hover:bg-win/90">
                  <Check size={12} />
                  Approve
                </Button>
              </>
            ) : (
              <Badge variant="outline" className={
                trade.status === 'accepted'
                  ? 'border-win/30 text-win bg-win/10'
                  : 'border-loss/30 text-loss bg-loss/10'
              }>
                {trade.status === 'accepted' ? 'Approved' : trade.status === 'rejected' ? 'Rejected' : 'Expired'}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
