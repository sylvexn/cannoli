import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { ApiTrade } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { Check, X, ArrowLeftRight, Clock } from 'lucide-react';

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
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}

export function AdminTrades() {
  const { leagues } = useAppData();
  const [tradeList, setTradeList] = useState<AdminTrade[]>([]);
  const [loading, setLoading] = useState(true);

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
        })))
      )
    ).then(results => {
      setTradeList(results.flat());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [leagues]);

  const pending = tradeList.filter(t => t.status === 'pending');
  const resolved = tradeList.filter(t => t.status !== 'pending');

  async function handleApprove(id: string) {
    try {
      await api.approveTrade(id);
      setTradeList(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'accepted' as const } : t
      ));
      toast.success('Trade approved');
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleReject(id: string) {
    try {
      await api.rejectTrade(id);
      setTradeList(prev => prev.map(t =>
        t.id === id ? { ...t, status: 'rejected' as const } : t
      ));
      toast.success('Trade rejected');
    } catch (err: any) { toast.error(err.message); }
  }

  if (loading) {
    return <div className="text-sm text-text-muted py-8 text-center">Loading trades...</div>;
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
                onReject={() => handleReject(trade.id)}
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
  const isPending = trade.status === 'pending';

  return (
    <Card className={!isPending ? 'opacity-60' : undefined}>
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
              {new Date(trade.proposedAt).toLocaleString()}
            </div>
          </div>

          {/* Actions / Status */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isPending ? (
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
