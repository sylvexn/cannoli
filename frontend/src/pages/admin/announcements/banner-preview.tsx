/**
 * ComposePreview — live preview panel for the announcement compose form.
 * Shows how the draft will look as a site banner and/or in the notification bell,
 * depending on the selected surface.
 */
import type { AnnouncementCategory, AnnouncementSurface } from '@/lib/api';
import { AnnouncementBannerStrip } from '@/components/announcement-banners';
import { NotificationRowView } from '@/components/app-shell/notifications-button';

interface ComposePreviewProps {
  title: string;
  body: string;
  link: string | null;
  category: AnnouncementCategory;
  surface: AnnouncementSurface;
}

export function ComposePreview({ title, body, link, category, surface }: ComposePreviewProps) {
  const displayTitle = title.trim() || 'Announcement title';
  const displayBody  = body.trim()  || 'Announcement body…';

  const showBanner = surface === 'banner' || surface === 'both';
  const showBell   = surface === 'bell'   || surface === 'both';

  return (
    <div className="space-y-3">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Live Preview</p>

      {showBanner && (
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-wider text-text-muted/60">As banner</p>
          <div className="rounded-md overflow-hidden border border-border-default">
            <AnnouncementBannerStrip
              title={displayTitle}
              body={displayBody}
              link={link || null}
              category={category}
              preview
            />
          </div>
        </div>
      )}

      {showBell && (
        <div className="space-y-1">
          <p className="text-[9px] uppercase tracking-wider text-text-muted/60">In notifications</p>
          <div className="rounded-md border border-border-default bg-surface-card px-3 py-2.5">
            <NotificationRowView
              source="announcement"
              title={displayTitle}
              body={displayBody}
              category={category}
              createdAt={new Date().toISOString()}
              read={false}
              expanded
            />
          </div>
        </div>
      )}

      {!showBanner && !showBell && (
        <p className="text-xs text-text-muted/60 italic">No surface selected.</p>
      )}
    </div>
  );
}
