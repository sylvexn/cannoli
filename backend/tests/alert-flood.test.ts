import { describe, test, expect } from 'bun:test';
import { takeNewAlertSlot, _suppressedNewAlertsForTest } from '../src/lib/alert';
import { clientErrorRateLimited } from '../src/routes/client-errors';

describe('alert flood guards', () => {
  test('new-error alerts capped at 10/min, rest suppressed', () => {
    const t = 10_000_000;
    let allowed = 0;
    for (let i = 0; i < 25; i++) if (takeNewAlertSlot(t)) allowed++;
    expect(allowed).toBe(10);
    expect(_suppressedNewAlertsForTest()).toBe(15);
    expect(takeNewAlertSlot(t + 61_000)).toBe(true); // new window
  });

  test('client-errors per-IP limit is 30/min', () => {
    const t = 20_000_000;
    let limited = 0;
    for (let i = 0; i < 40; i++) if (clientErrorRateLimited('1.2.3.4', t)) limited++;
    expect(limited).toBe(10);
    expect(clientErrorRateLimited('5.6.7.8', t)).toBe(false);
    expect(clientErrorRateLimited('1.2.3.4', t + 61_000)).toBe(false);
  });
});
