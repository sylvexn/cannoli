/**
 * MockRng — deterministic PRNG for the season simulator.
 *
 * Wraps the same linear-congruential generator used by `scripts/seed.ts` for
 * the player-availability grid (constants 1664525 / 1013904223, the classic
 * Numerical Recipes LCG). Seeding from the constructor makes every simulator
 * run reproducible: identical seed → identical season.
 *
 * The simulator deliberately uses ITS OWN RNG rather than Math.random so that
 * sim output is replayable — a sim API request can echo back the seed it used
 * and a later request can regenerate the exact same fictional season.
 */
export class MockRng {
  private state: number;

  constructor(seed = 0xdeadbeef) {
    // Scramble the seed before use. A bare LCG started from consecutive seeds
    // (1, 2, 3, …) produces correlated first outputs, so callers passing a
    // loop index as the seed would see biased early draws. The avalanche mix
    // below (a SplitMix32-style finalizer) decorrelates adjacent seeds.
    let s = (seed >>> 0) || 0x1;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = (s ^ (s >>> 16)) >>> 0;
    this.state = s || 0x1;
  }

  /** Raw step — advances state, returns a float in [0, 1). */
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform random element. Throws on empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('MockRng.pick: empty array');
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Weighted pick. Non-positive total weight falls back to uniform. */
  weighted<T>(items: { value: T; weight: number }[]): T {
    if (items.length === 0) throw new Error('MockRng.weighted: empty array');
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    if (total <= 0) return this.pick(items.map(i => i.value));
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, item.weight);
      if (r < 0) return item.value;
    }
    return items[items.length - 1]!.value;
  }

  /** True with probability p (clamped to [0, 1]). */
  bool(p = 0.5): boolean {
    return this.next() < Math.min(1, Math.max(0, p));
  }

  /** Fisher-Yates shuffle — returns a new array, does not mutate input. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
