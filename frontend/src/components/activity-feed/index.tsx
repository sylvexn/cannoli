/**
 * Shared activity feed component. Two visual variants:
 *
 *   - "dense"   — full narrative with avatars + entity chips. Used as the
 *                 primary feed on League Overview and on /me's main panel.
 *   - "compact" — single-line entries with a small icon + truncated text,
 *                 sized for narrow side columns.
 *
 * Both variants consume the same `ApiActivityEvent[]` slice and reuse the
 * same EVENT_ICONS / EVENT_TONES treatment so the colour language stays
 * consistent across surfaces.
 */

import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CoachLink } from '@/components/coach-link';
import { EventDescription } from '@/components/event-description';
import { EmptyState } from '@/components/empty-state';
import { useAppData } from '@/lib/app-data-context';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ApiActivityEvent, ApiTeam } from '@/lib/api';
import {
  Users, Swords, ArrowLeftRight, Trophy, ScrollText, Settings, Play, Check, Star, X,
} from 'lucide-react';

const EVENT_ICONS: Record<string, typeof Users> = {
  draft_started: Play, draft_pick: Trophy, draft_completed: Check,
  trade_proposed: ArrowLeftRight, trade_approved: Check, trade_rejected: X,
  match_reported: Swords, tera_captain_set: Star, tera_types_changed: Star,
  pin_awarded: Trophy,
};

type EventTone = {
  /** CSS color value used for icon tint + left border */
  color: string;
  /** Tailwind class fragment for icon */
  iconClass: string;
};

const EVENT_TONES: Record<string, EventTone> = {
  draft:  { color: '#22d3ee', iconClass: 'text-neon' },
  trade:  { color: '#e879f9', iconClass: 'text-pink' },
  match:  { color: '#fbbf24', iconClass: 'text-amber-400' },
  fa:     { color: '#a78bfa', iconClass: 'text-violet-400' },
  team:   { color: '#94a3b8', iconClass: 'text-text-secondary' },
  admin:  { color: '#5c6070', iconClass: 'text-text-muted' },
  scrim:  { color: '#a78bfa', iconClass: 'text-violet-400' },
  pin:    { color: '#fbbf24', iconClass: 'text-amber-400' },
};

function getEventTone(event: ApiActivityEvent): EventTone {
  if (event.type === 'pin_awarded' || event.type.startsWith('pin_')) {
    return EVENT_TONES.pin;
  }
  return EVENT_TONES[event.category] ?? EVENT_TONES.admin;
}

interface ActivityFeedProps {
  activity: ApiActivityEvent[];
  teamsPerLeague?: Record<string, ApiTeam[]>;
  variant?: 'dense' | 'compact';
  /** Optional title override. Defaults to "Recent Activity". */
  title?: string;
  /** When true, renders without the surrounding Card chrome. Useful for
   *  hub side columns that already have their own framing. */
  bare?: boolean;
  /** Cap on rendered events. Defaults to all. */
  limit?: number;
  /** Hide the count badge in the header. */
  hideCount?: boolean;
}

export function ActivityFeed({
  activity, teamsPerLeague, variant = 'dense',
  title = 'Recent Activity', bare = false, limit, hideCount = false,
}: ActivityFeedProps) {
  const events = limit != null ? activity.slice(0, limit) : activity;

  const body = (
    <>
      {events.length > 0 ? (
        <div className={cn(
          variant === 'dense'
            ? 'divide-y divide-border-subtle/40'
            : 'divide-y divide-border-subtle/30',
        )}>
          {events.map((event, i) => (
            <ActivityFeedItem
              key={event.id}
              event={event}
              teamsPerLeague={teamsPerLeague}
              variant={variant}
              index={i}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          variant="quiet"
          title="Quiet around here."
          subtitle="No league activity yet."
          spriteSize="md"
          padding="sm"
        />
      )}
    </>
  );

  if (bare) return body;

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className={cn('border-b border-border-subtle', variant === 'compact' ? 'pb-2 px-3 pt-3' : 'pb-2')}>
        <CardTitle className={cn(
          'font-heading flex items-center gap-2',
          variant === 'compact' ? 'text-xs' : 'text-sm',
        )}>
          <ScrollText size={variant === 'compact' ? 12 : 14} className="text-text-muted" />
          {title}
          {!hideCount && events.length > 0 && (
            <span className="text-[10px] font-mono text-text-muted/70 tabular-nums ml-1">
              {events.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">{body}</CardContent>
    </Card>
  );
}

interface ActivityFeedItemProps {
  event: ApiActivityEvent;
  teamsPerLeague?: Record<string, ApiTeam[]>;
  variant: 'dense' | 'compact';
  index: number;
}

function ActivityFeedItem({ event, teamsPerLeague, variant, index }: ActivityFeedItemProps) {
  const { leagues } = useAppData();
  const Icon = EVENT_ICONS[event.type] || Settings;
  const league = event.leagueId ? leagues.find(l => l.id === event.leagueId) : null;
  const tone = getEventTone(event);

  if (variant === 'compact') {
    // Compact: single line, sprite/icon + truncated text. Sized for narrow
    // side columns. The whole row is a coach link for affordance, but inner
    // CoachLink/EntityLinks would nest <a>; we render plain text descriptions
    // and rely on the timestamp + actor for context.
    return (
      <Link
        to={league ? `/league/${league.id}` : '/'}
        className="stagger-item flex items-center gap-2 px-2.5 py-1.5 hover:bg-surface-overlay/40 transition-colors border-l-2 group"
        style={{
          borderLeftColor: `${tone.color}80`,
          ['--i' as never]: Math.min(index, 20),
        }}
      >
        <Icon size={11} className={cn('shrink-0', tone.iconClass)} />
        <span className="flex-1 min-w-0 text-[11px] text-text-secondary truncate leading-tight">
          <span className="text-text-primary font-medium">{event.actor}</span>
          {' '}
          <CompactEventText event={event} />
        </span>
        <span className="text-[9px] font-mono text-text-muted shrink-0 tabular-nums">
          {event.timestamp ? formatRelativeTime(event.timestamp) : ''}
        </span>
      </Link>
    );
  }

  // Dense — full narrative variant.
  return (
    <div
      className="stagger-item row-interactive relative flex items-start gap-3 px-4 py-3 hover:bg-surface-overlay/30 transition-colors overflow-hidden border-l-2"
      style={{
        borderLeftColor: `${tone.color}80`,
        ['--i' as never]: Math.min(index, 20),
        ['--card-accent' as never]: league?.color ?? 'var(--color-neon)',
      }}
    >
      <CoachLink
        coach={{ username: event.actor }}
        showAvatar
        avatarSize="lg"
        avatarOnly
        size="xs"
        className="shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="text-[13px] font-heading text-text-secondary leading-snug">
          <CoachLink coach={{ username: event.actor }} size="sm" />
          {' '}
          <EventDescription event={event} teamsPerLeague={teamsPerLeague} />
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Icon size={11} className={cn('shrink-0', tone.iconClass)} />
          {league && (
            <span className="text-[10px] font-medium shrink-0" style={{ color: league.color }}>
              {league.name.replace(' League', '')}
            </span>
          )}
          <span className="text-[10px] font-mono text-text-muted shrink-0 tabular-nums">
            {event.timestamp ? formatRelativeTime(event.timestamp) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact-variant text: strips the actor prefix (rendered separately) and
 * uses the cleaned backend description verbatim — avoiding nested links so
 * the entire row can be a single <Link>.
 */
function CompactEventText({ event }: { event: ApiActivityEvent }) {
  let text = event.description ?? '';
  const actor = event.actor;
  if (actor && text.toLowerCase().startsWith(actor.toLowerCase() + ' ')) {
    text = text.slice(actor.length + 1);
  }
  return <span className="text-text-muted">{text}</span>;
}
