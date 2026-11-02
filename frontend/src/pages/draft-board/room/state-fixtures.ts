/**
 * Deterministic DraftState fixtures for the dev state jumper.
 *
 * Pure: (league config) -> { patch, flags }. `patch` is merged over the current
 * reducer state by HYDRATE_FIXTURE (which also forces source='simulator', so
 * nothing ever touches the server). `flags` are page-level overrides that are
 * not part of DraftState (WS connection, captain-gate condition).
 *
 * Every fixture is frozen on load (timerPaused) so the visual state stays put
 * for inspection; hit the CLOCK control to let it run.
 */
import type { Ruleset } from '@cannoli/rules';
import { getTierList, getBanned, type CostFormat } from '@/data/tier-list';
import { findPickConflict, captainHeadroomNeeded } from '@/lib/draft-rules';
import { generateSnakeSlots } from '../draft-reducer';
import type { DraftPickEntry, DraftState, SnakeSlot } from '../types';

export const FIXTURE_IDS = [
  'lobby', 'spectating', 'my-turn', 'my-turn-critical',
  'disconnected', 'last-pick', 'captain-gate', 'complete',
] as const;
export type FixtureId = (typeof FIXTURE_IDS)[number];

export const FIXTURE_LABELS: Record<FixtureId, string> = {
  lobby: 'lobby',
  spectating: 'R1 · spectating',
  'my-turn': 'my turn',
  'my-turn-critical': 'my turn · 0:08',
  disconnected: 'disconnected',
  'last-pick': 'last pick',
  'captain-gate': 'captain gate',
  complete: 'complete',
};

export function isFixtureId(v: string | null | undefined): v is FixtureId {
  return !!v && (FIXTURE_IDS as readonly string[]).includes(v);
}

/** Page-level conditions a fixture needs that DraftState cannot express. */
export interface FixtureFlags {
  /** Pretend the WS dropped (page: `wsConnected = flags.wsConnected ?? wsConnected`). */
  wsConnected?: false;
  /** Force the captain gate open (page: `captainGateOpen = flags.captainGateOpen ?? computed`). */
  captainGateOpen?: true;
}

export interface FixtureInput {
  /** Round-1 order, team ids. */
  teamIds: string[];
  userTeamId: string;
  rounds: number;
  pointCap: number;
  timerDuration: number;
  rules: Ruleset;
  format?: CostFormat;
  teraCaptainSlots?: number;
}

export interface Fixture {
  patch: Partial<DraftState>;
  flags: FixtureFlags;
}

/** Cheap deterministic hash -> [0, 1). */
function rnd(i: number): number {
  const x = Math.sin(i * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Legal, deterministic picks for the first `count` slots (same checks as the sim AI). */
export function buildPicks(snake: SnakeSlot[], count: number, inp: FixtureInput): DraftPickEntry[] {
  const banned = new Set(getBanned(inp.format));
  const pool = getTierList(inp.format)
    .filter(e => e.tier > 0 && !banned.has(e.name))
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
  const picks: DraftPickEntry[] = [];
  const taken = new Set<string>();
  const left = new Map<string, number>();
  for (const s of snake) left.set(s.teamId, (left.get(s.teamId) ?? 0) + 1);

  for (let i = 0; i < count; i++) {
    const slot = snake[i];
    const mine = picks.filter(p => p.playerId === slot.teamId);
    const roster = {
      pokemonNames: mine.map(p => p.pokemonName),
      pointsUsed: mine.reduce((n, p) => n + p.tier, 0),
      picksLeft: left.get(slot.teamId),
      captainReserve: inp.teraCaptainSlots
        ? captainHeadroomNeeded(
            mine.map(p => ({ name: p.pokemonName, tier: p.tier })),
            inp.teraCaptainSlots, inp.format, inp.rules,
          )
        : 0,
    };
    // Start somewhere in the top ~60 and walk forward to the first legal mon.
    const start = Math.floor(rnd(i + 1) * 60);
    let chosen: (typeof pool)[number] | null = null;
    for (let k = 0; k < pool.length && !chosen; k++) {
      const e = pool[(start + k) % pool.length];
      if (taken.has(e.name)) continue;
      if (findPickConflict(e.name, e.tier, roster, inp.pointCap, inp.rules)) continue;
      chosen = e;
    }
    if (!chosen) throw new Error(`fixture: no legal pick for slot ${i + 1}`);
    taken.add(chosen.name);
    left.set(slot.teamId, (left.get(slot.teamId) ?? 1) - 1);
    picks.push({
      round: slot.round, pick: slot.pick, overallPick: slot.overallPick,
      playerId: slot.teamId, pokemonName: chosen.name, tier: chosen.tier, isTeraCaptain: false,
    });
  }
  return picks;
}

export function buildFixture(id: FixtureId, inp: FixtureInput): Fixture {
  const snake = generateSnakeSlots(inp.teamIds, inp.rounds);
  const total = snake.length;

  // First slot of the user's at/after pick 4 (so there is history behind it).
  const myIdx = Math.max(0, snake.findIndex((s, i) => i >= 3 && s.teamId === inp.userTeamId));
  // Two picks before that, stepping back off any user slot.
  let specIdx = Math.max(0, myIdx - 2);
  while (specIdx > 0 && snake[specIdx].teamId === inp.userTeamId) specIdx--;

  const at = (index: number, extra: Partial<DraftState> = {}): Fixture => ({
    patch: {
      status: 'running',
      snakeOrder: snake,
      allPicks: buildPicks(snake, index, inp),
      currentPickIndex: index,
      userTeamId: inp.userTeamId,
      pointCap: inp.pointCap,
      timerDuration: inp.timerDuration,
      timerSeconds: inp.timerDuration,
      timerPaused: true,
      draftQueue: [],
      ...extra,
    },
    flags: {},
  });

  switch (id) {
    case 'lobby':
      return at(0, { status: 'configuring' });
    case 'spectating':
      return at(specIdx);
    case 'my-turn':
      return at(myIdx);
    case 'my-turn-critical':
      return at(myIdx, { timerSeconds: Math.min(8, inp.timerDuration) });
    case 'disconnected': {
      const f = at(specIdx);
      f.flags = { wsConnected: false };
      return f;
    }
    case 'last-pick':
      return at(total - 1);
    case 'captain-gate': {
      const f = at(total, { status: 'complete' });
      f.flags = { captainGateOpen: true };
      return f;
    }
    case 'complete':
      return at(total, { status: 'complete' });
  }
}
