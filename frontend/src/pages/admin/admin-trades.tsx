import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { trades } from '@/mocks/trades';
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
  status: 'pending' | 'approved' | 'rejected';
}

// Create mock pending trades for admin review (use existing trades as basis but mark as pending)
const pendingTrades: AdminTrade[] = [
  {
    id: 'admin-t1',
    leagueId: 'sapphire',
    leagueName: 'Sapphire',
    leagueColor: '#2563eb',
    week: 9,
    proposer: 'gwg',
    recipient: 'fam',
    offering: ['Qwilfish', 'Ferroseed'],
    requesting: ['Cubchoo'],
    proposedAt: '2026-03-28T14:30:00Z',
    status: 'pending',
  },
  {
    id: 'admin-t2',
    leagueId: 'sapphire',
    leagueName: 'Sapphire',
    leagueColor: '#2563eb',
    week: 9,
    proposer: 'pow',
    recipient: 'sas',
    offering: ['Eevee'],
    requesting: ['Pikachu'],
    proposedAt: '2026-03-29T10:00:00Z',
    status: 'pending',
  },
  {
    id: 'admin-t3',
    leagueId: 'ruby',
    leagueName: 'Ruby',
    leagueColor: '#dc2626',
    week: 8,
    proposer: 'trainer1',
    recipient: 'trainer2',
    offering: ['Larvitar'],
    requesting: ['Gastly', 'Haunter'],
    proposedAt: '2026-03-27T16:00:00Z',
    status: 'pending',
  },
];

export function AdminTrades() {
  const [tradeList, setTradeList] = useState<AdminTrade[]>(pendingTrades);

  const pending = tradeList.filter(t => t.status === 'pending');
  const resolved = tradeList.filter(t => t.status !== 'pending');

  function handleApprove(id: string) {
    setTradeList(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'approved' as const } : t
    ));
    toast.success('Trade approved');
  }

  function handleReject(id: string) {
    setTradeList(prev => prev.map(t =>
      t.id === id ? { ...t, status: 'rejected' as const } : t
    ));
    toast.success('Trade rejected');
  }

  // Recent completed trades from mock data
  const recentCompleted = trades
    .filter(t => t.status === 'accepted')
    .slice(-3)
    .reverse();

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

      {/* Recent Decisions */}
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

      {/* Recent Completed Trades */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-primary">Recently Completed</h3>
        <div className="space-y-2">
          {recentCompleted.map(trade => (
            <Card key={trade.id}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className="border-sapphire/30 text-sapphire bg-sapphire/10 shrink-0"
                    style={{ borderColor: '#2563eb30', color: '#2563eb', backgroundColor: '#2563eb10' }}>
                    Sapphire
                  </Badge>
                  <span className="text-text-muted">W{trade.week}</span>
                  <span className="text-text-primary font-medium">{trade.proposer}</span>
                  <ArrowLeftRight size={12} className="text-text-muted" />
                  <span className="text-text-primary font-medium">{trade.recipient}</span>
                  <span className="text-text-muted ml-auto text-xs">
                    {trade.resolvedAt ? new Date(trade.resolvedAt).toLocaleDateString() : ''}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
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
                trade.status === 'approved'
                  ? 'border-win/30 text-win bg-win/10'
                  : 'border-loss/30 text-loss bg-loss/10'
              }>
                {trade.status === 'approved' ? 'Approved' : 'Rejected'}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
