/**
 * Admin PS-replay archive routes.
 *
 * Surfaces the battle replays Pokemon Showdown autosaves to disk so admins can:
 *   - list every saved replay newest-first, cross-referenced to a Cannoli match
 *     (so bot-missed / "recoverable" battles are obvious);
 *   - inspect one replay's per-mon K/D + brought species;
 *   - download the raw `.log.json`.
 *
 * DEV-ONLY: mirrors bot-status — the group carries the shared `requireStaff`
 * guard, and each route narrows to `requireDev` (this is dev tooling against the
 * raw PS logs volume, not for admins).
 */

import { Elysia } from 'elysia';
import { requireStaff, requireDev } from '../../lib/auth-guards';
import { normalizeRoomId } from '../../lib/ps-bot';
import {
  listDiskReplays,
  summarizeDiskReplay,
  readDiskReplayFileRaw,
} from '../../lib/ps-replay-archive';

const MAX_LIMIT = 300;
const DEFAULT_LIMIT = 100;

export const psReplaysRoutes = new Elysia()
  .guard({ beforeHandle: requireStaff })

  // ─── List disk replays ──────────────────────────────────────────────
  .get('/api/admin/ps-replays', ({ query }) => {
    const requested = parseInt(query.limit as string, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const { available, dir, total, truncated, rows } = listDiskReplays(limit);
    return { available, dir, total, truncated, replays: rows };
  }, { beforeHandle: requireDev })

  // ─── Replay detail ──────────────────────────────────────────────────
  // :roomId may be URL-encoded (PS room ids contain no slashes, but normalize
  // + decode defensively in case a full URL was passed).
  .get('/api/admin/ps-replays/:roomId', ({ params, set }) => {
    const roomId = normalizeRoomId(decodeURIComponent(params.roomId));
    const detail = summarizeDiskReplay(roomId);
    if (!detail) {
      set.status = 404;
      return { error: 'Replay not found on disk' };
    }
    return detail;
  }, { beforeHandle: requireDev })

  // ─── Raw download ───────────────────────────────────────────────────
  .get('/api/admin/ps-replays/:roomId/download', ({ params, set }) => {
    const roomId = normalizeRoomId(decodeURIComponent(params.roomId));
    const file = readDiskReplayFileRaw(roomId);
    if (!file) {
      set.status = 404;
      return { error: 'Replay not found on disk' };
    }
    set.headers['Content-Type'] = 'application/json';
    set.headers['Content-Disposition'] = `attachment; filename="${roomId}.log.json"`;
    return file.raw;
  }, { beforeHandle: requireDev });
