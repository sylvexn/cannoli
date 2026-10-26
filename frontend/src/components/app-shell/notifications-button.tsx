import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCircle2, Megaphone, Swords, ArrowLeftRight, Shield, CheckCheck, type LucideIcon,
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
  type NotificationGroup,
  type AnnouncementCategory,
} from '@/lib/api';
import { ANNOUNCEMENT_CATEGORY_META } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

// Tabs + icon/accent maps

type Tab = 'all' | NotificationGroup;

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades & FA' },
  { id: 'matches', label: 'Matches' },
  { id: 'admin', label: 'Admin' },
  { id: 'feedback', label: 'Feedback' },
];

const GROUP_META: Record<NotificationGroup, { label: string; color: string; Icon: LucideIcon }> = {
  trades:   { label: 'Trades & FA', color: 'var(--color-purple-400, #c084fc)', Icon: ArrowLeftRight },
  matches:  { label: 'Match',       color: 'var(--color-amber-400, #fbbf24)',  Icon: Swords },
  admin:    { label: 'Admin',       color: 'var(--color-cyan-300, #67e8f9)',   Icon: Shield },
  feedback: { label: 'Feedback',    color: 'var(--color-neon, #34d399)',       Icon: CheckCircle2 },
};

/** Resolve the icon + accent + pill label for a notification. */
function getItemMeta(source: NotificationSource, category: string | null, group?: NotificationGroup) {
  if (source === 'announcement') {
    const ann = category ? ANNOUNCEMENT_CATEGORY_META[category as AnnouncementCategory] : undefined;
    return { label: 'announcement', color: ann?.color ?? 'var(--color-cyan-300, #67e8f9)', Icon: ann?.Icon ?? Megaphone };
  }
  return GROUP_META[group ?? (source === 'match' ? 'matches' : 'feedback')];
}

// Notification row

// Exported for use by admin preview surfaces.
export function NotificationRowView({
  source,
  title,
  body,
  category,
  group,
  createdAt,
  read = true,
  expanded = false,
}: {
  source: NotificationSource;
  title: string;
  body: string | null;
  category: string | null;
  group?: NotificationGroup;
  createdAt: string;
  read?: boolean;
  expanded?: boolean;
}) {
  const meta = getItemMeta(source, category, group);
  const { Icon } = meta;

  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0"
          style={{ color: meta.color, backgroundColor: `${meta.color}1f` }}
        >
          <Icon size={9} />
          {meta.label}
        </span>
        {!read && (
          <span className="h-1.5 w-1.5 rounded-full bg-neon shrink-0" title="Unread" />
        )}
        <span className="ml-auto text-[10px] text-text-muted tabular-nums shrink-0">
          {formatRelativeTime(createdAt)}
        </span>
      </div>

      <div className="mt-1 text-sm font-medium text-text-primary">{title}</div>

      {/* Body: always shown, except announcements which toggle open */}
      {body && (source !== 'announcement' || expanded) && (
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
  const isAnnouncement = item.source === 'announcement';
  const interactive = isAnnouncement || Boolean(item.link) || !isRead;

  function handleClick() {
    if (isAnnouncement) onToggleExpand();
    else onNavigate(item);
  }

  return (
    <div
      role={interactive ? 'button' : 'listitem'}
      tabIndex={interactive ? 0 : -1}
      onClick={handleClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      className={cn(
        'px-3 py-2.5 transition-colors outline-none',
        interactive
          ? 'cursor-pointer hover:bg-surface-overlay/40 focus-visible:bg-surface-overlay/40'
          : 'hover:bg-surface-overlay/50',
      )}
    >
      <NotificationRowView
        source={item.source}
        title={item.title}
        body={item.body}
        category={item.category}
        group={item.group}
        createdAt={item.createdAt}
        read={isRead}
        expanded={expanded}
      />
    </div>
  );
}

// Main component

interface NotificationsButtonProps {
  /** When true, renders an icon-only button (collapsed rail mode). */
  collapsed?: boolean;
}

export function NotificationsButton({ collapsed = false }: NotificationsButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Optimistic read marks until the next refetch replaces server state.
  const [localRead, setLocalRead] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    api.getNotifications()
      .then(res => { setItems(res.items); setLocalRead(new Set()); })
      .catch(() => { /* non-critical */ });
  }, []);

  // Fetch on mount / auth change, and again whenever the pane opens.
  useEffect(() => {
    if (user) load(); else setItems([]);
  }, [user?.id, load]);
  useEffect(() => { if (open && user) load(); }, [open, user, load]);

  const isRead = useCallback((i: NotificationItem) => i.read || localRead.has(i.id), [localRead]);
  const unreadIn = useCallback(
    (t: Tab) => items.filter(i => !isRead(i) && (t === 'all' || i.group === t)).length,
    [items, isRead],
  );
  const unread = unreadIn('all');
  const visible = useMemo(() => tab === 'all' ? items : items.filter(i => i.group === tab), [items, tab]);

  const markAllRead = useCallback(() => {
    const scope = items.filter(i => !isRead(i) && (tab === 'all' || i.group === tab));
    setLocalRead(prev => new Set([...prev, ...scope.map(i => i.id)]));
    api.markNotificationsSeen(tab === 'all' ? undefined : tab).then(load).catch(() => {});
  }, [items, isRead, tab, load]);

  const handleNavigate = useCallback((item: NotificationItem) => {
    if (item.id.startsWith('notif:') && !isRead(item)) {
      setLocalRead(prev => new Set(prev).add(item.id));
      api.markNotificationsRead([item.id]).catch(() => {});
    }
    if (!item.link) return;
    setOpen(false);
    if (item.link.startsWith('http://') || item.link.startsWith('https://')) {
      window.open(item.link, '_blank', 'noopener,noreferrer');
    } else {
      navigate(item.link);
    }
  }, [navigate, isRead]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  // Personal feed: nothing to show to guests.
  if (!user) return null;

  const badge = unread > 0 ? (
    <>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-neon" />
    </>
  ) : null;

  const count = (n: number) => n > 0 && (
    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-neon/20 text-neon text-[9px] font-bold tabular-nums">
      {n}
    </span>
  );

  const panel = (
    <PopoverContent side="top" align="start" sideOffset={8} className="w-full max-w-[22rem] p-0 gap-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Bell size={13} className="text-text-muted shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Notifications
        </span>
        <button
          type="button"
          onClick={markAllRead}
          disabled={unreadIn(tab) === 0}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-text-muted hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <CheckCheck size={12} />
          Mark all read
        </button>
      </div>
      <div className="flex gap-0.5 overflow-x-auto border-b border-border-default px-1.5 py-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
              tab === t.id ? 'bg-neon/10 text-neon' : 'text-text-muted hover:bg-surface-overlay hover:text-text-secondary',
            )}
          >
            {t.label}
            {count(unreadIn(t.id))}
          </button>
        ))}
      </div>
      <div className="max-h-[60dvh] overflow-y-auto py-1 divide-y divide-border-default/40">
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-muted">Nothing here.</div>
        ) : visible.map(item => (
          <NotificationRow
            key={item.id}
            item={item}
            isRead={isRead(item)}
            onNavigate={handleNavigate}
            expanded={expandedIds.has(item.id)}
            onToggleExpand={() => toggleExpanded(item.id)}
          />
        ))}
      </div>
    </PopoverContent>
  );

  // Collapsed rail (icon-only)
  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          title="Notifications"
          className="relative flex items-center justify-center h-9 w-9 rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors outline-none"
        >
          <span className="relative inline-flex">
            <Bell size={16} />
            {unread > 0 && (
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

  // Expanded sidebar row
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors outline-none">
        <span className="relative inline-flex">
          <Bell size={14} />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              {badge}
            </span>
          )}
        </span>
        <span>Notifications</span>
        <span className="ml-auto">{count(unread)}</span>
      </PopoverTrigger>
      {panel}
    </Popover>
  );
}
