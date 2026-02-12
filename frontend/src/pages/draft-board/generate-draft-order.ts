/**
 * Generates a snake draft pick sequence from per-team draft picks + standings.
 * Uses actual draft pick data from the API, ordered into snake-draft sequence.
 */

import type { Player } from '@/lib/types';
import type { ApiDraftPick } from '@/lib/api';
import type { DraftPickEntry, MockTrade } from './types';
import type { ApiTransaction } from '@/lib/api';

export function generateDraftOrder(
  standings: Player[],
  draftPicks: ApiDraftPick[],
): DraftPickEntry[] {
  // Draft order: worst record picks first
  const draftOrder = [...standings].reverse();

  // Build per-team pick queues sorted by pick number
  const queues = new Map<string, ApiDraftPick[]>();
  for (const p of draftOrder) {
    const teamPicks = draftPicks
      .filter(dp => dp.teamId === p.id)
      .sort((a, b) => a.pickNumber - b.pickNumber);
    queues.set(p.id, teamPicks);
  }

  const picks: DraftPickEntry[] = [];
  const maxRounds = Math.max(...[...queues.values()].map(q => q.length), 0);

  for (let round = 1; round <= maxRounds; round++) {
    // Snake: odd rounds go forward, even rounds go reverse
    const order = round % 2 === 1 ? draftOrder : [...draftOrder].reverse();

    for (let i = 0; i < order.length; i++) {
      const player = order[i];
      const queue = queues.get(player.id)!;
      const next = queue.shift();
      if (!next) continue;

      picks.push({
        round,
        pick: i + 1,
        overallPick: picks.length + 1,
        playerId: player.id,
        pokemonName: next.pokemonName,
        tier: next.tier,
        isTeraCaptain: false,
      });
    }
  }

  return picks;
}

/**
 * Convert API transactions into trade overlays for the draft board.
 */
export function transactionsToTrades(transactions: ApiTransaction[]): MockTrade[] {
  const trades: MockTrade[] = [];
  for (const tx of transactions) {
    if (tx.type !== 'fa' && tx.type !== 'trade') continue;
    // Pokemon going out from teamId
    if (tx.pokemonOut) {
      trades.push({
        week: tx.week,
        fromTeamId: tx.teamId,
        toTeamId: tx.otherTeamId || 'pool',
        pokemonName: tx.pokemonOut,
      });
    }
    // Pokemon coming in to teamId
    if (tx.pokemonIn) {
      trades.push({
        week: tx.week,
        fromTeamId: tx.otherTeamId || 'pool',
        toTeamId: tx.teamId,
        pokemonName: tx.pokemonIn,
      });
    }
  }
  return trades;
}
