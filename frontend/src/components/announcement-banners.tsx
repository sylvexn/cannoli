/**
 * Announcement banner strip components.
 *
 * AnnouncementBannerStrip — presentational single-banner row.
 * AnnouncementBanners     — container: fetches /api/banners and stacks them.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, ArrowRight } from 'lucide-react';
import { api, type ApiBanner, type AnnouncementCategory } from '@/lib/api';
import { ANNOUNCEMENT_CATEGORY_META } from '@/lib/constants';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

// Presentational strip

export function AnnouncementBannerStrip({
  title,
  body,
  link,
  category,
  onDismiss,
  preview = false,
}: {
  title: string;
  body: string;
  link?: string | null;
  category: AnnouncementCategory;
  onDismiss?: () => void;
  preview?: boolean;
}) {
  const meta = ANNOUNCEMENT_CATEGORY_META[category];
  const { Icon } = meta;

  const isInternal = link && !link.startsWith('http://') && !link.startsWith('https://');

  const linkEl = link ? (
    isInternal && !preview ? (
      <Link
        to={link}
        className={cn(
          'group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium transition-colors shrink-0',
          meta.bannerClass,
          'border-current/40 hover:bg-current/20',
        )}
      >
        Learn more
        <ArrowRight size={10} className="transition-transform group-hover:translate-x-0.5" />
      </Link>
    ) : (
      <a
        href={link}
        target={preview ? undefined : '_blank'}
        rel="noopener noreferrer"
        onClick={preview ? (e) => e.preventDefault() : undefined}
        className={cn(
          'group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium transition-colors shrink-0',
          meta.bannerClass,
          'border-current/40 hover:bg-current/20',
        )}
      >
        Learn more
        <ArrowRight size={10} className="transition-transform group-hover:translate-x-0.5" />
      </a>
    )
  ) : null;

  return (
    <div className={cn('shrink-0 border-b', meta.bannerClass)}>
      <div className="flex items-center gap-3 px-4 py-1.5 text-[11px]">
        <Icon size={12} className="shrink-0" />
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <span className="font-semibold truncate">{title}</span>
          {body && (
            <>
              <span className="hidden sm:inline h-3 w-px bg-current/30 shrink-0" />
              <span className="hidden sm:inline text-current/70 truncate min-w-0">{body}</span>
            </>
          )}
        </div>
        {linkEl && <div className="ml-auto pl-2 shrink-0">{linkEl}</div>}
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss announcement"
            className="shrink-0 ml-1 p-0.5 rounded hover:bg-current/20 transition-colors outline-none"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// Container

const DISMISSED_KEY = 'cannoli:dismissedBanners';

function getDismissedIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as number[];
  } catch {
    return [];
  }
}

function addDismissedId(id: number) {
  try {
    const ids = getDismissedIds();
    if (!ids.includes(id)) {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids, id]));
    }
  } catch {
    // ignore storage errors
  }
}

export function AnnouncementBanners() {
  const { user } = useAuth();
  const [banners, setBanners] = useState<ApiBanner[]>([]);

  useEffect(() => {
    let cancelled = false;

    api.getBanners()
      .then(items => {
        if (cancelled) return;
        // For guest users filter out locally dismissed banners
        if (!user) {
          const dismissed = new Set(getDismissedIds());
          setBanners(items.filter(b => !dismissed.has(b.id)));
        } else {
          setBanners(items);
        }
      })
      .catch(() => {
        // Non-critical — render nothing on error
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (banners.length === 0) return null;

  function handleDismiss(id: number) {
    setBanners(prev => prev.filter(b => b.id !== id));
    if (user) {
      api.dismissAnnouncement(id).catch(() => {});
    } else {
      addDismissedId(id);
    }
  }

  return (
    <>
      {[...banners].reverse().map(banner => (
        <AnnouncementBannerStrip
          key={banner.id}
          title={banner.title}
          body={banner.body}
          link={banner.link}
          category={banner.category}
          onDismiss={() => handleDismiss(banner.id)}
        />
      ))}
    </>
  );
}
