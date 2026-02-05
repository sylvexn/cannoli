import type { Trade, TradeBlockListing } from '@/lib/types';

/** Trade deadline config */
export const TRADE_DEADLINE_WEEK = 8;

/**
 * Mock trades for Sapphire League Season 10.
 * Includes completed trades, pending proposals, rejected, and free agent pickups.
 */
export const trades: Trade[] = [
  // Completed trades
  {
    id: 't1',
    week: 3,
    status: 'accepted',
    proposer: 'gwg',
    recipient: 'ece',
    offering: ['Qwilfish'],
    requesting: ['Cofagrigus'],
    proposedAt: '2026-02-10T14:30:00Z',
    resolvedAt: '2026-02-11T09:15:00Z',
  },
  {
    id: 't2',
    week: 5,
    status: 'accepted',
    proposer: 'fam',
    recipient: 'pow',
    offering: ['Cubchoo'],
    requesting: ['Simisear'],
    proposedAt: '2026-02-24T18:00:00Z',
    resolvedAt: '2026-02-25T11:30:00Z',
  },
  {
    id: 't3',
    week: 6,
    status: 'accepted',
    proposer: 'sas',
    recipient: 'mgm',
    offering: ['Pikachu'],
    requesting: ['Fennekin'],
    proposedAt: '2026-03-03T20:00:00Z',
    resolvedAt: '2026-03-04T16:45:00Z',
  },

  // Free agent pickups (recipient = 'pool')
  {
    id: 't4',
    week: 4,
    status: 'accepted',
    proposer: 'gg',
    recipient: 'pool',
    offering: ['Ditto'],
    requesting: ['Murkrow'],
    proposedAt: '2026-02-17T12:00:00Z',
    resolvedAt: '2026-02-17T12:00:00Z',
  },
  {
    id: 't5',
    week: 7,
    status: 'accepted',
    proposer: 'hmm',
    recipient: 'pool',
    offering: ['Cursola'],
    requesting: ['Pincurchin'],
    proposedAt: '2026-03-10T10:00:00Z',
    resolvedAt: '2026-03-10T10:00:00Z',
  },

  // Rejected trade
  {
    id: 't6',
    week: 5,
    status: 'rejected',
    proposer: 'dwg',
    recipient: 'llb',
    offering: ['Stunfisk'],
    requesting: ['Zoroark'],
    proposedAt: '2026-02-23T15:00:00Z',
    resolvedAt: '2026-02-24T08:00:00Z',
  },

  // Pending proposal (awaiting admin)
  {
    id: 't9',
    week: 7,
    status: 'pending',
    proposer: 'vvv',
    recipient: 'llb',
    offering: ['Meowscarada'],
    requesting: ['Blaziken'],
    proposedAt: '2026-03-08T11:00:00Z',
  },

  // Expired proposals (submitted before deadline, unresolved)
  {
    id: 't7',
    week: 8,
    status: 'expired',
    proposer: 'ak',
    recipient: 'vvv',
    offering: ['Pawniard'],
    requesting: ['Fraxure'],
    proposedAt: '2026-03-16T14:00:00Z',
  },
  {
    id: 't8',
    week: 7,
    status: 'expired',
    proposer: 'mgm',
    recipient: 'ece',
    offering: ['Cacturne', 'Ferroseed'],
    requesting: ['Dedenne'],
    proposedAt: '2026-03-09T20:00:00Z',
  },
];

/** Pokemon listed as available for trade (before deadline) */
export const tradeBlockListings: TradeBlockListing[] = [
  { teamId: 'dwg', pokemonName: 'Stunfisk', note: 'Looking for a fairy or water type' },
  { teamId: 'pow', pokemonName: 'Eevee', note: 'Open to any offers' },
  { teamId: 'gg', pokemonName: 'Electrode', note: 'Need ground coverage' },
  { teamId: 'hmm', pokemonName: 'Electrode', note: 'Will trade for any fighting type' },
  { teamId: 'sas', pokemonName: 'Charizard', note: 'Looking for bulky water' },
  { teamId: 'llb', pokemonName: 'Ferroseed' },
  { teamId: 'vvv', pokemonName: 'Meowscarada', note: 'Need a spinner or defogger' },
  { teamId: 'ak', pokemonName: 'Pawniard', note: 'Open to offers, need speed' },
];

/** Get trades involving a specific team */
export function getTeamTrades(teamId: string): Trade[] {
  return trades.filter(t => t.proposer === teamId || t.recipient === teamId);
}

/** Get accepted trades only */
export function getCompletedTrades(): Trade[] {
  return trades.filter(t => t.status === 'accepted');
}
