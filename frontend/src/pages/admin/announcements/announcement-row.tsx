/**
 * AnnouncementRow — a single row in the admin announcements list.
 * Shows category, surface, league, role badges; title, body, link; author +
 * relative time; retract / edit actions.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type ApiAnnouncement } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { ANNOUNCEMENT_CATEGORY_META } from '@/lib/constants';
import { Bell, Tv, BellDot, Pencil, X } from 'lucide-react';

// Surface badge

function SurfaceBadge({ surface }: { surface: ApiAnnouncement['surface'] }) {
  const map = {
    bell:   { label: 'Bell',        Icon: Bell },
    banner: { label: 'Banner',      Icon: Tv },
    both:   { label: 'Bell+Banner', Icon: BellDot },
  } as const;
  const { label, Icon } = map[surface];
  return (
    <Badge
      variant="outline"
      className="text-[9px] gap-1 px-1.5 py-0.5 text-text-muted border-border-default"
    >
      <Icon size={9} />
      {label}
    </Badge>
  );
}

// Row

interface AnnouncementRowProps {
  item: ApiAnnouncement;
  onEdit: (a: ApiAnnouncement) => void;
  onRetracted: () => void;
}

export function AnnouncementRow({ item, onEdit, onRetracted }: AnnouncementRowProps) {
  const [busy, setBusy] = useState(false);
  const { leagues } = useAppData();

  const meta = ANNOUNCEMENT_CATEGORY_META[item.category];
  const Icon = meta.Icon;

  // Resolve league name for the badge
  const leagueName = item.leagueId
    ? (leagues.find(l => l.id === item.leagueId)?.name?.replace(' League', '') ?? item.leagueId)
    : null;

  const leagueColor = item.leagueId
    ? (leagues.find(l => l.id === item.leagueId)?.color ?? '#64748b')
    : null;

  const roleLabel =
    item.targetRole === 'admin' ? 'Admins' :
    item.targetRole === 'user'  ? 'Members' :
    null;

  const wasEdited = item.updatedAt && item.updatedAt !== item.createdAt;

  async function handleRetract() {
    if (!confirm(`Retract "${item.title}"? Users will no longer see this announcement.`)) return;
    setBusy(true);
    try {
      await api.retractAnnouncement(item.id);
      toast.success('Announcement retracted');
      onRetracted();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Retract failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* Category badge */}
      <Badge
        variant="outline"
        className={`shrink-0 mt-0.5 text-[9px] gap-1 px-1.5 py-0.5 ${meta.badgeClass}`}
      >
        <Icon size={9} />
        {meta.label}
      </Badge>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">{item.title}</span>
          {!item.active && (
            <Badge variant="outline" className="text-[9px] text-text-muted border-border-default">
              retracted
            </Badge>
          )}
          {wasEdited && (
            <span className="text-[9px] text-text-muted/50 italic">edited</span>
          )}
        </div>

        {/* Surface + league + role inline badges */}
        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
          <SurfaceBadge surface={item.surface} />
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
          {roleLabel && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0.5 text-text-muted border-border-default">
              {roleLabel}
            </Badge>
          )}
        </div>

        <div className="mt-1 text-xs text-text-muted whitespace-pre-line leading-relaxed">
          {item.body}
        </div>
        {item.link && (
          <div className="mt-1 text-[10px] font-mono text-text-muted/60 truncate">
            {item.link}
          </div>
        )}
        <div className="mt-1 text-[10px] text-text-muted/60 flex items-center gap-2">
          {item.createdByUsername && (
            <span>by <span className="text-text-muted">{item.createdByUsername}</span></span>
          )}
          <span>{formatRelativeTime(item.createdAt)}</span>
        </div>
      </div>

      {/* Actions (active only) */}
      {item.active && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(item)}
            disabled={busy}
            title="Edit this announcement"
            className="h-7 w-7 p-0 text-text-muted hover:text-text-primary opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetract}
            disabled={busy}
            title="Retract this announcement"
            className="h-7 w-7 p-0 text-text-muted hover:text-loss opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <X size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}
