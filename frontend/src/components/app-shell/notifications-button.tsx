import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Sparkles, Wrench, Bug, CheckCircle2, Megaphone, Swords,
} from 'lucide-react';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  api,
  type NotificationItem,
  type NotificationSource,
  type AnnouncementCategory,
} from '@/lib/api';
import type { ChangelogCategory } from '@/lib/api';
import { ANNOUNCEMENT_CATEGORY_META } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// ─── Source + category icon/accent maps ──────────────────────────────────────

const CHANGELOG_META: Record<ChangelogCategory, { label: string; color: string; Icon: typeof Sparkles }> = {
  feature:     { label: 'New',      color: 'var(--color-neon, #34d399)',      Icon: Sparkles },
  improvement: { label: 'Improved', color: 'var(--color-cyan-300, #67e8f9)',  Icon: Wrench },
  fix:         { label: 'Fixed',    color: 'var(--color-amber-400, #fbbf24)', Icon: Bug },
};

const SOURCE_DEFAULTS: Record<NotificationSource, { color: string; Icon: typeof Bell }> = {
  changelog:    { color: 'var(--color-neon, #34d399)',       Icon: Sparkles },
  feedback:     { color: 'var(--color-neon, #34d399)',       Icon: CheckCircle2 },
  announcement: { color: 'var(--color-cyan-300, #67e8f9)',   Icon: Megaphone },
  match:        { color: 'var(--color-amber-400, #fbbf24)',  Icon: Swords },
};

/** Resolve the icon + accent for a single notification item. */
function getItemMeta(item: NotificationItem) {
  if (item.source === 'changelog' && item.category) {
    return CHANGELOG_META[item.category as ChangelogCategory] ?? CHANGELOG_META.improvement;
  }
  if (item.source === 'announcement' && item.category) {
    const ann = ANNOUNCEMENT_CATEGORY_META[item.category as AnnouncementCategory];
    if (ann) return { color: ann.color, Icon: ann.Icon };
  }
  return SOURCE_DEFAULTS[item.source];
}

// ─── Notification row ─────────────────────────────────────────────────────────

// Exported for use by admin preview surfaces.
export function NotificationRowView({
  source,
  title,
  body,
  category,
  createdAt,
  read = true,
  expanded = false,
}: {
  source: NotificationSource;
  title: string;
  body: string | null;
  category: string | null;
  createdAt: string;
  read?: boolean;
  expanded?: boolean;
}) {
  // Build a minimal fake item to reuse the same meta resolver.
  const fakeItem = { source, category } as NotificationItem;
  const meta = getItemMeta(fakeItem);
  const { Icon } = meta;

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0"
          style={{ color: meta.color, backgroundColor: `${meta.color}1f` }}
        >
          <Icon size={9} />
          {source === 'changelog'
            ? ((meta as (typeof CHANGELOG_META)[ChangelogCategory]).label ?? source)
            : source}
        </span>
        {!read && (
          <span className="h-1.5 w-1.5 rounded-full bg-neon shrink-0" title="Unread" />
        )}
        <span className="ml-auto text-[10px] text-text-muted tabular-nums shrink-0">
          {formatRelativeTime(createdAt)}
        </span>
      </div>

      <div className="mt-1 text-sm font-medium text-text-primary">{title}</div>

      {/* Body: always show for changelog; toggle for announcements; collapse for others */}
      {body && (source === 'changelog' || source === 'feedback' || expanded) && (
        <div className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-text-muted">
          {body}
        </div>
      )}
      {source === 'announcement' && body && !expanded && (
        <div className="mt-0.5 text-[10px] text-text-muted">Tap to expand</div>
      )}
    </>
  );
}

interface NotificationRowProps {
  item: NotificationItem;
  /** Optimistic local read state (may override item.read). */
  isRead: boolean;
  onNavigate: (item: NotificationItem) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

function NotificationRow({ item, isRead, onNavigate, expanded, onToggleExpand }: NotificationRowProps) {
  // Announcements expand inline; match/changelog/feedback navigate or do nothing.
  const isClickable = item.source !== 'announcement';
  const hasLink = Boolean(item.link);

  function handleClick() {
    if (item.source === 'announcement') {
      onToggleExpand();
    } else if (hasLink) {
      onNavigate(item);
    }
  }

  return (
    <div
      role={isClickable && hasLink ? 'button' : item.source === 'announcement' ? 'button' : 'listitem'}
      tabIndex={(isClickable && hasLink) || item.source === 'announcement' ? 0 : -1}
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      className={cn(
        'px-3 py-2.5 transition-colors outline-none',
        (isClickable && hasLink) || item.source === 'announcement'
          ? 'cursor-pointer hover:bg-surface-overlay/40 focus-visible:bg-surface-overlay/40'
          : 'hover:bg-surface-overlay/50',
      )}
    >
      <NotificationRowView
        source={item.source}
        title={item.title}
        body={item.body}
        category={item.category}
        createdAt={item.createdAt}
        read={isRead}
        expanded={expanded}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NotificationsButtonProps {
  /** When true, renders an icon-only button (collapsed rail mode). */
  collapsed?: boolean;
}

export function NotificationsButton({ collapsed = false }: NotificationsButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Guest fallback — mirrors changelog-button: localStorage stamp drives read state
  // for changelog items when there's no auth session.
  const [guestSeen, setGuestSeen] = useLocalStorageState<string | null>('cannoli:changelogSeenAt', null);

  // Fetch on mount and on auth change.
  useEffect(() => {
    let cancelled = false;

    if (user) {
      api.getNotifications()
        .then(res => {
          if (cancelled) return;
          setItems(res.items);
          setUnreadCount(res.unreadCount);
        })
        .catch(() => { /* non-critical */ });
    } else {
      // Guest: only changelog items, read state from localStorage.
      api.getChangelog()
        .then(res => {
          if (cancelled) return;
          const changelogItems: NotificationItem[] = res.entries.map(e => ({
            id: `changelog:${e.id}`,
            source: 'changelog' as const,
            title: e.title,
            body: e.body ?? null,
            link: null,
            category: e.category,
            createdAt: e.date,
            read: guestSeen ? e.date <= guestSeen : false,
          }));
          setItems(changelogItems);
          const unread = changelogItems.filter(i => !i.read).length;
          setUnreadCount(unread);
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Recompute the guest unread count whenever guestSeen changes.
  useEffect(() => {
    if (user) return;
    setUnreadCount(items.filter(i => !guestSeen || i.createdAt > guestSeen).length);
  }, [guestSeen, items, user]);

  // Derive locally-read items (optimistic zero on open).
  const [localRead, setLocalRead] = useState<Set<string>>(new Set());

  const effectiveUnread = useMemo(
    () => Math.max(0, unreadCount - localRead.size),
    [unreadCount, localRead],
  );

  const markAllSeen = useCallback(() => {
    setLocalRead(new Set(items.filter(i => !i.read).map(i => i.id)));

    if (user) {
      api.markNotificationsSeen().catch(() => {});
    } else {
      // Guest: stamp to the newest entry date (same logic as changelog-button).
      const seenAt = items.reduce(
        (max, e) => (e.createdAt > max ? e.createdAt : max),
        new Date().toISOString(),
      );
      setGuestSeen(seenAt);
    }
  }, [items, user, setGuestSeen]);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next && effectiveUnread > 0) markAllSeen();
  }, [effectiveUnread, markAllSeen]);

  const handleNavigate = useCallback((item: NotificationItem) => {
    if (!item.link) return;
    setOpen(false);
    if (item.link.startsWith('http://') || item.link.startsWith('https://')) {
      window.open(item.link, '_blank', 'noopener,noreferrer');
    } else {
      navigate(item.link);
    }
  }, [navigate]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  const badge = effectiveUnread > 0 ? (
    <>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-neon" />
    </>
  ) : null;

  const panel = (
    <PopoverContent side="top" align="start" sideOffset={8} className="w-80 p-0 gap-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Bell size={13} className="text-text-muted" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Notifications
        </span>
        {effectiveUnread > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-neon/20 text-neon text-[9px] font-bold tabular-nums">
            {effectiveUnread}
          </span>
        )}
      </div>
      <div className="max-h-[60dvh] overflow-y-auto py-1 divide-y divide-border-default/40">
        {items.map(item => (
          <NotificationRow
            key={item.id}
            item={item}
            isRead={item.read || localRead.has(item.id)}
            onNavigate={handleNavigate}
            expanded={expandedIds.has(item.id)}
            onToggleExpand={() => toggleExpanded(item.id)}
          />
        ))}
      </div>
    </PopoverContent>
  );

  // ── Collapsed rail (icon-only) ────────────────────────────────────────────
  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          title="Notifications"
          className="relative flex items-center justify-center h-9 w-9 rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors outline-none"
        >
          <span className="relative inline-flex">
            <Bell size={16} />
            {effectiveUnread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                {badge}
              </span>
            )}
          </span>
        </PopoverTrigger>
        {panel}
      </Popover>
    );
  }

  // ── Expanded sidebar row ──────────────────────────────────────────────────
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors outline-none">
        <span className="relative inline-flex">
          <Bell size={14} />
          {effectiveUnread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              {badge}
            </span>
          )}
        </span>
        <span>Notifications</span>
        {effectiveUnread > 0 && (
          <span className="ml-auto inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-neon/20 text-neon text-[9px] font-bold tabular-nums">
            {effectiveUnread}
          </span>
        )}
      </PopoverTrigger>
      {panel}
    </Popover>
  );
}
