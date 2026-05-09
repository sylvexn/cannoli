/**
 * Tests for the bot's disk-replay-fallback helpers.
 *
 * The full integration path (`replayFromDisk` → `handleMatchEnd`) is tested
 * implicitly through manual smoke tests; here we pin down the two pure
 * helpers that decide which file to read.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { formatFromRoomId, readReplayLogFromDisk } from '../src/lib/ps-bot';

describe('formatFromRoomId', () => {
  test('extracts format slug from a standard PS room id', () => {
    expect(formatFromRoomId('battle-gen9natdexdraft-12345')).toBe('gen9natdexdraft');
  });

  test('handles password-suffixed rooms', () => {
    expect(formatFromRoomId('battle-gen9natdexdraft-12345-abc123')).toBe('gen9natdexdraft');
  });

  test('returns null for non-battle rooms', () => {
    expect(formatFromRoomId('lobby')).toBeNull();
    expect(formatFromRoomId('')).toBeNull();
    expect(formatFromRoomId('battle-')).toBeNull();
  });
});

describe('readReplayLogFromDisk', () => {
  let root: string;
  const ROOM_ID = 'battle-gen9natdexdraft-99999';
  const LOG_LINES = [
    '|player|p1|alice|',
    '|player|p2|bob|',
    '|tier|[Gen 9] NatDex Draft',
    '|win|alice',
  ];

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cannoli-disk-replay-'));
    const dateDir = join(root, 'gen9natdexdraft', '2026-05-08');
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(
      join(dateDir, `${ROOM_ID}.log.json`),
      JSON.stringify({ log: LOG_LINES, players: ['alice', 'bob'] }),
    );
    // Add an older date dir to confirm the scanner walks all dates, not just today.
    mkdirSync(join(root, 'gen9natdexdraft', '2026-04-01'), { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('reads log array from a saved replay', () => {
    const lines = readReplayLogFromDisk(ROOM_ID, root);
    expect(lines).toEqual(LOG_LINES);
  });

  test('returns null when the room id has no matching file', () => {
    const lines = readReplayLogFromDisk('battle-gen9natdexdraft-00001', root);
    expect(lines).toBeNull();
  });

  test('returns null when the format dir does not exist', () => {
    const lines = readReplayLogFromDisk('battle-gen9ou-99999', root);
    expect(lines).toBeNull();
  });

  test('returns null when rootDir does not exist (warns, does not throw)', () => {
    const lines = readReplayLogFromDisk(ROOM_ID, join(root, 'does-not-exist'));
    expect(lines).toBeNull();
  });

  test('returns null for malformed room ids', () => {
    expect(readReplayLogFromDisk('not-a-room', root)).toBeNull();
  });
});
