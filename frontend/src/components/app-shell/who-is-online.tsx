/**
 * Sidebar who's-online widget.
 *
 * Renders an avatar stack of users who hit the API in the last 15 minutes.
 * Polls /api/online every 30s. The heartbeat is set on the backend by every
 * authenticated request, so we don't need a separate client-side ping.
 *
 * Design intent: small, glanceable, friendly. "There are people here right
 * now" is the only signal — clicking an avatar deep-links to their coach
 * profile, hover surfaces username + status_message via native title.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CoachAvatar } from '@/components/coach-avatar';
import { Users } from 'lucide-react';

interface OnlineUser {
  id: number;
  username: string;
  displayName: string | null;
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  role: 'dev' | 'admin' | 'user';
  statusMessage: string | null;
  lastSeenAt: string | null;
}

const POLL_MS = 30_000;
const VISIBLE_LIMIT = 6;

export function WhoIsOnline() {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Lazy import to keep this file's deps lean and avoid a circular
        // dep chain through api.ts during AppShell's module init.
        const { api } = await import('@/lib/api');
        const res = await api.getOnlineUsers();
        if (cancelled) return;
        setUsers(res.users);
        setLoaded(true);
      } catch {
        // Best-effort widget — quietly hide on error. Backend may be a few
        // versions old (no /api/online); keep the sidebar clean rather than
        // surface a noisy retry state.
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Hide entirely until first successful fetch, and on empty.
  if (!loaded || users.length === 0) return null;

  const visible = users.slice(0, VISIBLE_LIMIT);
  const overflow = users.length - visible.length;

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-1.5 mb-1.5 text-[10px] uppercase tracking-wider text-text-muted">
        <Users size={11} />
        <span>Online</span>
        <span className="font-mono text-text-muted/70">{users.length}</span>
      </div>
      <div className="flex items-center -space-x-2">
        {visible.map(u => {
          const tooltip = u.statusMessage
            ? `${u.displayName || u.username} — ${u.statusMessage}`
            : (u.displayName || u.username);
          return (
            <Link
              key={u.id}
              to={`/coach/${u.username}`}
              title={tooltip}
              className="ring-2 ring-surface-raised rounded-full hover:ring-neon/50 transition-all hover:translate-y-[-1px] hover:z-10 relative"
            >
              <CoachAvatar
                username={u.username}
                displayName={u.displayName}
                avatarPath={u.avatarPath}
                primaryColor={u.primaryColor}
                secondaryColor={u.secondaryColor}
                size="sm"
                presence="online"
              />
            </Link>
          );
        })}
        {overflow > 0 && (
          <div
            className="ring-2 ring-surface-raised rounded-full bg-surface-overlay text-text-muted text-[9px] font-mono font-bold flex items-center justify-center"
            style={{ width: 20, height: 20 }}
            title={`${overflow} more`}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
