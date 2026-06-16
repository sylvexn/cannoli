/**
 * Trade Desk — the "Trade Block" tab of the Market hub. Composes three pieces:
 *   • TheBlock        — browse listings + list/unlist your own mons
 *   • TradeActivity   — needs-you band, your sent offers, history
 *   • TradeComposer   — the single focused propose/counter flow
 *
 * This page owns the data (listings + trades) and the composer's open state;
 * the children are presentational + action-dispatching and reload via callbacks.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { api, type ApiTradeBlockListing, type ApiTrade } from '@/lib/api';
import type { Trade } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useMarket } from './index';
import { TheBlock } from './the-block';
import { TradeActivity } from './trade-activity';
import { TradeComposer } from './trade-composer';

interface ComposerState {
  recipientTeamId?: string | null;
  preselectRequesting?: string[];
  counterTo?: Trade | null;
}

export function TradeDeskPage() {
  const league = useLeague();
  const { transactions } = useLeagueData();
  const { actingTeam } = useMarket();

  const tradeDeadlineWeek = league.season.tradeDeadlineWeek ?? 7;
  const deadlinePassed = league.season.currentWeek > tradeDeadlineWeek;

  // ── Data: block listings ────────────────────────────────────────────────
  const [listings, setListings] = useState<ApiTradeBlockListing[]>([]);
  const reloadListings = useCallback(() => {
    api.getTradeBlock(league.id).then(setListings).catch(() => {});
  }, [league.id]);
  useEffect(() => { reloadListings(); }, [reloadListings]);

  // ── Data: live trade proposals (pending/awaiting/rejected/expired) ───────
  const [apiTrades, setApiTrades] = useState<ApiTrade[]>([]);
  const reloadTrades = useCallback(() => {
    api.getTrades(league.id).then(setApiTrades).catch(() => {});
  }, [league.id]);
  useEffect(() => { reloadTrades(); }, [reloadTrades]);

  // Merge live trade rows with accepted FA/trade transactions into one list.
  // Accepted trades arrive as transactions (to avoid double-counting the
  // accepted live rows), everything else comes straight from the trade rows.
  const trades: Trade[] = useMemo(() => {
    const fromApi: Trade[] = apiTrades
      .filter(t => t.status !== 'accepted')
      .map(t => ({
        id: t.id,
        week: t.week,
        status: t.status,
        proposer: t.proposerId,
        recipient: t.recipientId,
        offering: t.offering,
        requesting: t.requesting,
        proposedAt: t.proposedAt || '',
        resolvedAt: t.resolvedAt || '',
      }));

    const fromTransactions: Trade[] = transactions
      .filter(t => t.type === 'fa' || t.type === 'trade')
      .map(t => ({
        id: `t${t.id}`,
        week: t.week,
        status: 'accepted' as const,
        proposer: t.teamId,
        recipient: t.type === 'fa' ? 'pool' : (t.otherTeamId || 'pool'),
        offering: t.pokemonOut ? [t.pokemonOut] : [],
        requesting: t.pokemonIn ? [t.pokemonIn] : [],
        proposedAt: '',
        resolvedAt: '',
      }));

    return [...fromApi, ...fromTransactions];
  }, [apiTrades, transactions]);

  // ── Composer ─────────────────────────────────────────────────────────────
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const closeComposer = useCallback(() => {
    setComposer(null);
    reloadTrades();
    reloadListings();
  }, [reloadTrades, reloadListings]);

  return (
    <div className="space-y-4">
      {actingTeam && !deadlinePassed && (
        <div className="flex justify-end">
          <Button
            size="sm"
            className="gap-1.5 bg-neon text-surface-base hover:bg-neon/90"
            onClick={() => setComposer({})}
          >
            <Plus size={14} />
            New trade
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
        <TheBlock
          listings={listings}
          onOffer={({ recipientTeamId, pokemonName }) =>
            setComposer({ recipientTeamId, preselectRequesting: [pokemonName] })
          }
          onChanged={reloadListings}
          actingTeam={actingTeam}
          deadlinePassed={deadlinePassed}
        />

        <TradeActivity
          trades={trades}
          onChanged={reloadTrades}
          onCounter={trade => setComposer({ counterTo: trade })}
          actingTeam={actingTeam}
        />
      </div>

      {actingTeam && (
        <TradeComposer
          open={composer !== null}
          onClose={closeComposer}
          proposerTeam={actingTeam}
          recipientTeamId={composer?.recipientTeamId}
          preselectRequesting={composer?.preselectRequesting}
          counterTo={composer?.counterTo}
        />
      )}
    </div>
  );
}
