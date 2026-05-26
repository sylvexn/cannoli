/**
 * Tests for the stale-in-progress sweep's deadline check.
 *
 * Mirrors auto-forfeit.test.ts in style — exercise the pure 24h-from-startedAt
 * predicate so the sweep's "is this match stuck?" decision is testable
 * without spinning up the DB / matches fixtures.
 */
import { describe, expect, test } from 'bun:test';
import { isStaleInProgress, STALE_IN_PROGRESS_MS } from '../src/lib/jobs/stale-in-progress';

describe('isStaleInProgress', () => {
  const now = new Date('2026-05-08T12:00:00.000Z');

  test('returns false when startedAt is null', () => {
    expect(isStaleInProgress(null, now)).toBe(false);
  });

  test('returns false when startedAt is malformed (does not throw)', () => {
    expect(isStaleInProgress('not a date', now)).toBe(false);
  });

  test('returns false for a match started 1 hour ago', () => {
    const startedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(isStaleInProgress(startedAt, now)).toBe(false);
  });

  test('returns false for a match started 23h59m ago (under threshold)', () => {
    const startedAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 - 60_000)).toISOString();
    expect(isStaleInProgress(startedAt, now)).toBe(false);
  });

  test('returns true at exactly 24h (>= threshold)', () => {
    const startedAt = new Date(now.getTime() - STALE_IN_PROGRESS_MS).toISOString();
    expect(isStaleInProgress(startedAt, now)).toBe(true);
  });

  test('returns true for a match started 48 hours ago', () => {
    const startedAt = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    expect(isStaleInProgress(startedAt, now)).toBe(true);
  });

  test('threshold constant is 24 hours in ms', () => {
    expect(STALE_IN_PROGRESS_MS).toBe(86_400_000);
  });
});
