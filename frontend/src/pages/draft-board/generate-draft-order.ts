/**
 * Generates a mock snake draft order from existing roster data.
 * Worst record picks first (reversed standings). Each team's roster
 * is sorted by tier descending — higher-cost Pokemon drafted earlier.
 */

import type { Player } from '@/lib/types';
import type { DraftPickEntry, MockTrade } from './types';

export function generateDraftOrder(standings: Player[]): DraftPickEntry[] {
  // Draft order: worst record picks first
  const draftOrder = [...standings].reverse();

  // Each team's picks sorted by tier (highest first = drafted earliest)
  const queues = new Map(
    draftOrder.map(p => [
      p.id,
      [...p.roster].sort((a, b) => b.tier - a.tier),
    ])
  );

  const picks: DraftPickEntry[] = [];
  const rounds = Math.max(...draftOrder.map(p => p.roster.length));

  for (let round = 1; round <= rounds; round++) {
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
        pokemonName: next.name,
        tier: next.tier,
        isTeraCaptain: next.isTeraCaptain,
      });
    }
  }

  return picks;
}

/**
 * Mock trades that happened during the season.
 * These overlay onto draft results to show current ownership.
 */
export const MOCK_TRADES: MockTrade[] = [
  { week: 3, fromTeamId: 'hmm', toTeamId: 'gwg', pokemonName: 'Electrode' },
  { week: 5, fromTeamId: 'pow', toTeamId: 'fam', pokemonName: 'Sandaconda' },
  { week: 5, fromTeamId: 'fam', toTeamId: 'pow', pokemonName: 'Cactus' }, // placeholder
  { week: 7, fromTeamId: 'gg', toTeamId: 'ece', pokemonName: 'Drifblim' },
];
