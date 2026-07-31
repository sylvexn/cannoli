/**
 * SentLog — unified admin notification delivery log.
 * Shows the last N entries from /api/admin/notifications/log (newest first),
 * with a "Load more" button when a nextBefore cursor is available.
 */
import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api, type AdminNotificationLogEntry } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { formatRelativeTime } from '@/lib/format';
import { ANNOUNCEMENT_CATEGORY_META } from '@/lib/constants';
import type { AnnouncementCategory } from '@/lib/api';
import { Bell, Tv, BellDot } from 'lucide-react';

const VALID_CATEGORIES = new Set<string>(['info', 'feature', 'event', 'maintenance']);

// Surface badge

function SurfaceBadge({ surface }: { surface: string | null }) {
  if (!surface) return null;
  const map: Record<string, { label: string; Icon: typeof Bell }> = {
    bell:   { label: 'Bell',        Icon: Bell },
    banner: { label: 'Banner',      Icon: Tv },
    both:   { label: 'Bell+Banner', Icon: BellDot },
  };
  const entry = map[surface];
  if (!entry) return null;
  const { label, Icon } = entry;
  return (
    <Badge variant="outline" className="text-[9px] gap-1 px-1.5 py-0.5 text-text-muted border-border-default">
      <Icon size={9} />
      {label}
    </Badge>
  );
}

// Log entry row

function LogEntryRow({ entry, leagueName, leagueColor }: {
  entry: AdminNotificationLogEntry;
  leagueName: string | null;
  leagueColor: string | null;
}) {
  const isAnnouncement = entry.kind === 'announcement';

  // Resolve category meta only if the category is a valid key
  const catMeta = (entry.category && VALID_CATEGORIES.has(entry.category))
    ? ANNOUNCEMENT_CATEGORY_META[entry.category as AnnouncementCategory]
    : null;

  const CatIcon = catMeta?.Icon;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* Kind badge */}
      <Badge
        variant="outline"
        className={`shrink-0 mt-0.5 text-[9px] px-1.5 py-0.5 ${
          isAnnouncement
            ? 'text-neon border-neon/30 bg-neon/10'
            : 'text-purple-400 border-purple-400/30 bg-purple-400/10'
        }`}
      >
        {isAnnouncement ? 'Announcement' : 'Directed'}
      </Badge>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{entry.title}</span>
          {entry.retracted && (
            <Badge variant="outline" className="text-[9px] text-text-muted border-border-default">
              retracted
            </Badge>
          )}
        </div>

        {/* Metadata badges */}
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          {isAnnouncement ? (
            <>
              {catMeta && CatIcon && (
                <Badge
                  variant="outline"
                  className={`text-[9px] gap-1 px-1.5 py-0.5 ${catMeta.badgeClass}`}
                >
                  <CatIcon size={9} />
                  {catMeta.label}
                </Badge>
              )}
              <SurfaceBadge surface={entry.surface} />
              {leagueName ? (
                <Badge
                  variant="outline"
                  className="text-[9px] gap-1 px-1.5 py-0.5 border-border-default"
                  style={{ color: leagueColor ?? undefined }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0 inline-block"
                    style={{ backgroundColor: leagueColor ?? '#64748b' }}
                  />
                  {leagueName}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 text-text-muted/50 border-border-default">
                  All leagues
                </Badge>
              )}
              {entry.targetRole && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 text-text-muted border-border-default">
                  {entry.targetRole === 'admin' ? 'Admins' : 'Members'}
                </Badge>
              )}
            </>
          ) : (
            entry.recipientUsername && (
              <span className="text-[10px] text-text-muted/70 font-mono">
                → {entry.recipientUsername}
              </span>
            )
          )}
        </div>

        {/* Body (clamped) */}
        {entry.body && (
          <div className="mt-1 text-xs text-text-muted line-clamp-2 leading-relaxed">
            {entry.body}
          </div>
        )}

        {/* Timestamp */}
        <div className="mt-1 text-[10px] text-text-muted/60">
          {formatRelativeTime(entry.createdAt)}
        </div>
      </div>
    </div>
  );
}

// Sent log

export function SentLog() {
  const { leagues } = useAppData();
  const [items, setItems] = useState<AdminNotificationLogEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getAdminNotificationLog({ limit: 50 })
      .then(res => {
        setItems(res.items);
        setNextBefore(res.nextBefore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await api.getAdminNotificationLog({ before: nextBefore, limit: 50 });
      setItems(prev => [...prev, ...res.items]);
      setNextBefore(res.nextBefore);
    } catch {
      // non-critical
    } finally {
      setLoadingMore(false);
    }
  }

  // Helper to resolve league info from items
  function resolveLeague(leagueId: string | null) {
    if (!leagueId) return { name: null, color: null };
    const l = leagues.find(x => x.id === leagueId);
    return {
      name:  l ? l.name.replace(' League', '') : leagueId,
      color: l?.color ?? '#64748b',
    };
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            <LoadingSprite />
          ) : items.length === 0 ? (
            <EmptyState
              variant="quiet"
              title="No notifications sent yet."
              spriteSize="md"
              padding="sm"
            />
          ) : (
            items.map(entry => {
              const { name, color } = resolveLeague(entry.leagueId);
              return (
                <LogEntryRow
                  key={entry.id}
                  entry={entry}
                  leagueName={name}
                  leagueColor={color}
                />
              );
            })
          )}
        </CardContent>
      </Card>

      {nextBefore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="h-7 text-xs text-text-muted"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
