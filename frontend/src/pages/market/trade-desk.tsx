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
import { isTradeDeadlinePassed } from '@/lib/trade-validation';
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
  // Shared with the badge and the backend — this used to be a private `>` that
  // left the Block offering trades the backend would reject during week 7.
  const deadlinePassed = isTradeDeadlinePassed(league.season.currentWeek, tradeDeadlineWeek);

  // Data: block listings
  const [listings, setListings] = useState<ApiTradeBlockListing[]>([]);
  const reloadListings = useCallback(() => {
    api.getTradeBlock(league.id).then(setListings).catch(() => {});
  }, [league.id]);
  useEffect(() => { reloadListings(); }, [reloadListings]);

  // Data: live trade proposals (pending/awaiting/rejected/expired)
  const [apiTrades, setApiTrades] = useState<ApiTrade[]>([]);
  const reloadTrades = useCallback(() => {
    api.getTrades(league.id).then(setApiTrades).catch(() => {});
  }, [league.id]);
  useEffect(() => { reloadTrades(); }, [reloadTrades]);

  // Merge live trade rows with accepted FA/trade transactions into one list.
  // APPLIED trades arrive as transactions (to avoid double-counting the
  // accepted live rows), everything else comes straight from the trade rows —
  // including trades approved for a FUTURE week, which have no transaction row
  // yet and would otherwise vanish from both lists until they take effect.
  const trades: Trade[] = useMemo(() => {
    const fromApi: Trade[] = apiTrades
      .filter(t => t.status !== 'accepted' || !t.appliedAt)
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
        effectiveWeek: t.effectiveWeek,
        appliedAt: t.appliedAt,
      }));

    // Trades map 1:1 — each accepted-trade transaction already carries both
    // sides for one team's perspective.
    const fromTrades: Trade[] = transactions
      .filter(t => t.type === 'trade')
      .map(t => ({
        id: `t${t.id}`,
        week: t.week,
        status: 'accepted' as const,
        proposer: t.teamId,
        recipient: t.otherTeamId || 'pool',
        offering: t.pokemonOut ? [t.pokemonOut] : [],
        requesting: t.pokemonIn ? [t.pokemonIn] : [],
        proposedAt: '',
        resolvedAt: '',
      }));

    // FA pickups: new ones are a single combined row, but legacy data split a
    // "drop X, add Y" pickup into a drop-only row and a pickup-only row, which
    // rendered as two broken "— for Y" / "X for —" lines (feedback #41). Per
    // team+week, keep combined rows as-is and zip the leftover one-sided rows
    // back into single entries.
    const fromFa: Trade[] = [];
    const faByTeamWeek = new Map<string, typeof transactions>();
    for (const t of transactions.filter(t => t.type === 'fa')) {
      const key = `${t.teamId}:${t.week}`;
      const list = faByTeamWeek.get(key) ?? [];
      list.push(t);
      faByTeamWeek.set(key, list);
    }
    for (const [key, rows] of faByTeamWeek) {
      const team = rows[0].teamId;
      const week = rows[0].week;
      const mkTrade = (id: string, out: string[], inn: string[]): Trade => ({
        id, week, status: 'accepted', proposer: team, recipient: 'pool',
        offering: out, requesting: inn, proposedAt: '', resolvedAt: '',
      });
      const outOnly = rows.filter(r => r.pokemonOut && !r.pokemonIn);
      const inOnly = rows.filter(r => !r.pokemonOut && r.pokemonIn);
      for (const r of rows.filter(r => r.pokemonOut && r.pokemonIn)) {
        fromFa.push(mkTrade(`fa${r.id}`, [r.pokemonOut!], [r.pokemonIn!]));
      }
      const pairs = Math.max(outOnly.length, inOnly.length);
      for (let i = 0; i < pairs; i++) {
        const out = outOnly[i]?.pokemonOut ? [outOnly[i].pokemonOut!] : [];
        const inn = inOnly[i]?.pokemonIn ? [inOnly[i].pokemonIn!] : [];
        fromFa.push(mkTrade(`fa-${key}-${i}`, out, inn));
      }
    }

    return [...fromApi, ...fromTrades, ...fromFa];
  }, [apiTrades, transactions]);

  // Composer
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
