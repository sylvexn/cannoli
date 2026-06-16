import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import type { ApiActivityEvent } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { useFormatTime, useFormatDate } from '@/lib/format';
import type { EventCategory } from '@/lib/types';
import { EmptyState } from '@/components/empty-state';

const EVENT_CATEGORIES: EventCategory[] = ['admin', 'auth', 'config', 'draft', 'trade', 'fa', 'match', 'team'];
const CATEGORY_LABELS: Record<string, string> = {
  admin: 'Admin', auth: 'Auth', config: 'Config', draft: 'Draft',
  trade: 'Trade', fa: 'FA', match: 'Match', team: 'Team',
};
import {
  Search, Filter, X, UserPlus, KeyRound, ShieldCheck, UserX, LogIn,
  Settings, Play, Trophy, ArrowLeftRight, Check, Swords, Star,
  Sparkles, ChevronDown, FolderPlus, FolderPen, FolderX, Plus, Pencil, Minus,
} from 'lucide-react';

const CATEGORY_COLORS: Record<EventCategory, string> = {
  admin: 'border-pink/30 text-pink bg-pink/10',
  auth: 'border-text-muted/30 text-text-muted bg-text-muted/10',
  config: 'border-neon/30 text-neon bg-neon/10',
  draft: 'border-draw/30 text-draw bg-draw/10',
  trade: 'border-purple-400/30 text-purple-400 bg-purple-400/10',
  fa: 'border-cyan-400/30 text-cyan-400 bg-cyan-400/10',
  match: 'border-win/30 text-win bg-win/10',
  team: 'border-orange-400/30 text-orange-400 bg-orange-400/10',
  scrim: 'border-neon/30 text-neon bg-neon/10',
};

const EVENT_ICONS: Record<string, typeof UserPlus> = {
  user_created: UserPlus,
  user_role_changed: ShieldCheck,
  user_deactivated: UserX,
  user_reactivated: ShieldCheck,
  user_updated: ShieldCheck,
  password_reset: KeyRound,
  password_changed: KeyRound,
  user_login: LogIn,
  league_config_updated: Settings,
  phase_advanced: Play,
  season_created: Sparkles,
  draft_started: Play,
  draft_pick: Trophy,
  draft_completed: Check,
  trade_proposed: ArrowLeftRight,
  trade_approved: Check,
  trade_rejected: X,
  match_reported: Swords,
  tera_captain_set: Star,
  tera_types_changed: Star,
  move_category_created: FolderPlus,
  move_category_updated: FolderPen,
  move_category_deleted: FolderX,
  move_category_entry_added: Plus,
  move_category_entry_updated: Pencil,
  move_category_entry_deleted: Minus,
};

const PAGE_SIZE = 15;

export function AdminActivityLog() {
  const { leagues } = useAppData();
  const [allEvents, setAllEvents] = useState<ApiActivityEvent[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    api.getActivityLog({ limit: 500 })
      .then(({ events }) => setAllEvents(events))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let events = [...allEvents];

    if (categoryFilter !== 'all') {
      events = events.filter(e => e.category === categoryFilter);
    }
    if (leagueFilter !== 'all') {
      events = events.filter(e => e.leagueId === leagueFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      events = events.filter(e =>
        e.description.toLowerCase().includes(q) ||
        e.actor.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        JSON.stringify(e.metadata).toLowerCase().includes(q)
      );
    }

    return events;
  }, [allEvents, search, categoryFilter, leagueFilter]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const activeFilters = (categoryFilter !== 'all' ? 1 : 0) +
    (leagueFilter !== 'all' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setCategoryFilter('all');
    setLeagueFilter('all');
    setVisibleCount(PAGE_SIZE);
  }

  // Category breakdown counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of allEvents) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  }, [allEvents]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total Events:</span>
          <span className="text-text-primary font-medium font-mono">{allEvents.length}</span>
        </div>
        {EVENT_CATEGORIES.map(cat => (
          categoryCounts[cat] ? (
            <button
              key={cat}
              onClick={() => setCategoryFilter(categoryFilter === cat ? 'all' : cat)}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <Badge variant="outline" className={`${CATEGORY_COLORS[cat]} ${categoryFilter === cat ? 'ring-1 ring-current' : ''}`}>
                {CATEGORY_LABELS[cat]} {categoryCounts[cat]}
              </Badge>
            </button>
          ) : null
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder="Search events..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v ?? 'all'); setVisibleCount(PAGE_SIZE); }}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <Filter size={12} className="mr-1 text-text-muted" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {EVENT_CATEGORIES.map(cat => (
              <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={leagueFilter} onValueChange={v => { setLeagueFilter(v ?? 'all'); setVisibleCount(PAGE_SIZE); }}>
          <SelectTrigger className="w-[140px] h-8 text-sm">
            <SelectValue placeholder="League" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Leagues</SelectItem>
            {leagues.map(l => (
              <SelectItem key={l.id} value={l.id}>{l.name.replace(' League', '')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 text-text-muted hover:text-text-primary">
            <X size={12} />
            Clear ({activeFilters})
          </Button>
        )}
      </div>

      {/* Event list */}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {visible.length === 0 ? (
            <EmptyState
              variant="nothing-here"
              title="No events match your filters."
              spriteSize="md"
              padding="sm"
            />
          ) : (
            visible.map((event, i) => (
              <div
                key={event.id}
                className="stagger-item"
                style={{ ['--i' as never]: Math.min(i, 20) }}
              >
                <EventRow event={event} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
            className="text-text-muted hover:text-text-primary"
          >
            <ChevronDown size={14} />
            Show more ({filtered.length - visibleCount} remaining)
          </Button>
        </div>
      )}

      {/* Results count */}
      {activeFilters > 0 && (
        <p className="text-xs text-text-muted text-center">
          Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} filtered events
        </p>
      )}
    </div>
  );
}

function EventRow({ event }: { event: ApiActivityEvent }) {
  const { leagues } = useAppData();
  const fmtTime = useFormatTime();
  const fmtDate = useFormatDate();
  const Icon = EVENT_ICONS[event.type] || Settings;
  const league = event.leagueId ? leagues.find(l => l.id === event.leagueId) : null;

  const ts = new Date(event.timestamp ?? Date.now());
  const isToday = new Date().toDateString() === ts.toDateString();
  const timeStr = isToday ? fmtTime(ts) : fmtDate(ts, { year: 'hide' });

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/50 transition-colors group">
      {/* Icon */}
      <div className={`shrink-0 w-7 h-7 rounded-md flex items-center justify-center ${(CATEGORY_COLORS[event.category as EventCategory] ?? '').replace('border-', 'bg-').split(' ')[0]}10`}>
        <Icon size={14} className={(CATEGORY_COLORS[event.category as EventCategory] ?? '').split(' ')[1]} />
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-text-primary">{event.actor}</span>
          <span className="text-text-secondary truncate">{event.description}</span>
        </div>
        {/* Metadata chips */}
        {'targetUser' in event.metadata && (
          <span className="text-xs text-text-muted">
            Target: {String(event.metadata.targetUser)}
          </span>
        )}
      </div>

      {/* League badge */}
      <div className="shrink-0 w-20 text-right">
        {league && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5"
            style={{
              borderColor: `${league.color}40`,
              color: league.color,
              backgroundColor: `${league.color}10`,
            }}
          >
            {league.name.replace(' League', '')}
          </Badge>
        )}
      </div>

      {/* Category */}
      <Badge variant="outline" className={`shrink-0 text-[10px] ${CATEGORY_COLORS[event.category as EventCategory] ?? ''}`}>
        {CATEGORY_LABELS[event.category] ?? event.category}
      </Badge>

      {/* Timestamp */}
      <span className="shrink-0 w-16 text-right text-xs text-text-muted font-mono tabular-nums">
        {timeStr}
      </span>
    </div>
  );
}
