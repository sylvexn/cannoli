import { useState, useEffect, useMemo, useCallback } from 'react';
import { Bell, Sparkles, Wrench, Bug } from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { api, type ApiChangelogEntry, type ChangelogCategory } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLocalStorageState } from '@/lib/use-local-storage-state';

// Per-category accent + icon. Kept local — these labels/colors are only ever
// shown inside the changelog panel.
const CATEGORY_META: Record<ChangelogCategory, { label: string; color: string; Icon: typeof Sparkles }> = {
  feature: { label: 'New', color: 'var(--color-neon, #34d399)', Icon: Sparkles },
  improvement: { label: 'Improved', color: 'var(--color-cyan-300, #67e8f9)', Icon: Wrench },
  fix: { label: 'Fixed', color: 'var(--color-amber-400, #fbbf24)', Icon: Bug },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Sidebar "What's New" row. Pulses a bell when there are changelog entries
 * dated after the user last opened the panel; clears the moment they open it.
 *
 * Read-state: logged-in users persist on the server (user_preferences); guests
 * fall back to localStorage so the pulse still behaves for them.
 */
export function ChangelogButton() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ApiChangelogEntry[]>([]);
  const [serverSeen, setServerSeen] = useState<string | null>(null);
  const [guestSeen, setGuestSeen] = useLocalStorageState<string | null>('cannoli:changelogSeenAt', null);
  const [open, setOpen] = useState(false);

  // The effective "last opened" timestamp depends on whether we have a session.
  const lastSeen = user ? serverSeen : guestSeen;

  // Load the feed once per auth state. Re-fetch on login so the server-side
  // seen timestamp replaces the guest localStorage value.
  useEffect(() => {
    let cancelled = false;
    api.getChangelog()
      .then(res => {
        if (cancelled) return;
        setEntries(res.entries);
        if (user) setServerSeen(res.lastSeenAt);
      })
      .catch(() => { /* non-critical — leave the bell dormant */ });
    return () => { cancelled = true; };
  }, [user?.id]);

  const unread = useMemo(
    () => entries.filter(e => !lastSeen || e.date > lastSeen).length,
    [entries, lastSeen],
  );

  // Mark everything seen the instant the panel opens (clears the pulse). We
  // stamp local state optimistically so the badge disappears immediately, then
  // persist (server for members, localStorage for guests).
  const markSeen = useCallback(() => {
    // Stamp to the newest entry's date (or now, whichever is later). Entries can
    // be dated slightly ahead of wall-clock; stamping plain `now` would leave a
    // future-dated entry permanently "unread" — opening could never clear it.
    // Comparing against the newest entry date means opening always clears the
    // pulse, and only a genuinely newer entry re-triggers it.
    const seenAt = entries.reduce((max, e) => (e.date > max ? e.date : max), new Date().toISOString());
    if (user) {
      setServerSeen(seenAt);
      api.markChangelogSeen().catch(() => { /* best-effort */ });
    } else {
      setGuestSeen(seenAt);
    }
  }, [user, setGuestSeen, entries]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next && unread > 0) markSeen();
  }, [unread, markSeen]);

  if (entries.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors outline-none">
        <span className="relative inline-flex">
          <Bell size={14} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-neon" />
            </span>
          )}
        </span>
        <span>What's New</span>
        {unread > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-neon/20 text-neon text-[9px] font-bold tabular-nums">
            {unread}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent side="top" align="start" sideOffset={8} className="w-80 p-0 gap-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
          <Bell size={13} className="text-text-muted" />
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">What's New</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {entries.map(entry => {
            const meta = CATEGORY_META[entry.category] ?? CATEGORY_META.improvement;
            const isUnread = !lastSeen || entry.date > lastSeen;
            const { Icon } = meta;
            return (
              <div key={entry.id} className="px-3 py-2.5 hover:bg-surface-overlay/40 transition-colors">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                    style={{ color: meta.color, backgroundColor: `${meta.color}1f` }}
                  >
                    <Icon size={9} />
                    {meta.label}
                  </span>
                  {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-neon" title="New since you last looked" />}
                  <span className="ml-auto text-[10px] text-text-muted tabular-nums">{formatDate(entry.date)}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-text-primary">{entry.title}</div>
                {entry.body && (
                  <div className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-text-muted">{entry.body}</div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
