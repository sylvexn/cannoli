import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api, type ApiAnnouncement, type AnnouncementCategory } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import {
  Megaphone, Info, Zap, CalendarDays, AlertTriangle, X, RefreshCw,
} from 'lucide-react';

// ─── Category display metadata ─────────────────────────────────────────────

interface CategoryMeta {
  label: string;
  color: string;
  Icon: typeof Megaphone;
}

const CATEGORY_META: Record<AnnouncementCategory, CategoryMeta> = {
  info:        { label: 'Info',        color: 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10',   Icon: Info },
  feature:     { label: 'Feature',     color: 'text-neon border-neon/30 bg-neon/10',               Icon: Zap },
  event:       { label: 'Event',       color: 'text-purple-400 border-purple-400/30 bg-purple-400/10', Icon: CalendarDays },
  maintenance: { label: 'Maintenance', color: 'text-amber-400 border-amber-400/30 bg-amber-400/10', Icon: AlertTriangle },
};

const CATEGORIES: AnnouncementCategory[] = ['info', 'feature', 'event', 'maintenance'];

// ─── Compose form ─────────────────────────────────────────────────────────────

interface ComposeFormProps {
  onCreated: () => void;
}

function ComposeForm({ onCreated }: ComposeFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('info');
  const [busy, setBusy] = useState(false);

  const titleTrimmed = title.trim();
  const bodyTrimmed = body.trim();
  const canSubmit = titleTrimmed.length > 0 && bodyTrimmed.length > 0 && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    try {
      await api.createAnnouncement({
        title: titleTrimmed,
        body: bodyTrimmed,
        link: link.trim() || undefined,
        category,
      });
      toast.success('Announcement posted');
      setTitle('');
      setBody('');
      setLink('');
      setCategory('info');
      onCreated();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Failed to post announcement');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Megaphone size={14} className="text-neon" />
          New Announcement
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Title + Category on one line */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
                Title
              </label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="What's happening?"
                className="h-8 text-sm"
                maxLength={120}
                required
              />
            </div>
            <div className="w-36 shrink-0">
              <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
                Category
              </label>
              <Select value={category} onValueChange={v => setCategory(v as AnnouncementCategory)}>
                <SelectTrigger size="sm" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => {
                    const meta = CATEGORY_META[cat];
                    const Icon = meta.Icon;
                    return (
                      <SelectItem key={cat} value={cat}>
                        <Icon size={12} />
                        {meta.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Body */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
              Body
            </label>
            <Textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Details of the announcement…"
              rows={3}
              maxLength={1000}
              required
            />
          </div>

          {/* Optional link */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
              Link <span className="normal-case text-text-muted/60">(optional)</span>
            </label>
            <Input
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://… or /route/path"
              className="h-8 text-sm font-mono"
              type="text"
            />
          </div>

          <div className="flex justify-end pt-1">
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className="h-8 text-xs"
            >
              {busy ? 'Posting…' : 'Post Announcement'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Announcement row ─────────────────────────────────────────────────────────

interface AnnouncementRowProps {
  item: ApiAnnouncement;
  onRetracted: () => void;
}

function AnnouncementRow({ item, onRetracted }: AnnouncementRowProps) {
  const [busy, setBusy] = useState(false);
  const meta = CATEGORY_META[item.category];
  const Icon = meta.Icon;

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
    <div className="flex items-start gap-3 px-4 py-3 group">
      {/* Category badge */}
      <Badge
        variant="outline"
        className={`shrink-0 mt-0.5 text-[9px] gap-1 px-1.5 py-0.5 ${meta.color}`}
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
        </div>
        <div className="mt-0.5 text-xs text-text-muted whitespace-pre-line leading-relaxed">
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

      {/* Retract action (active only) */}
      {item.active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetract}
          disabled={busy}
          title="Retract this announcement"
          className="h-7 w-7 p-0 shrink-0 text-text-muted hover:text-loss opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={13} />
        </Button>
      )}
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState<ApiAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const load = useCallback(() => {
    setLoading(true);
    api.listAnnouncements()
      .then(setAnnouncements)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter === 'active'
    ? announcements.filter(a => a.active)
    : announcements;

  return (
    <div className="space-y-5">
      <ComposeForm onCreated={load} />

      {/* List header */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          {filter === 'active' ? 'Active' : 'All'} Announcements
          {!loading && (
            <span className="ml-2 text-text-muted font-normal">({visible.length})</span>
          )}
        </h3>

        {/* Filter toggle */}
        <div className="flex gap-1 rounded-md border border-border-default p-0.5">
          {(['active', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                filter === f
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {f === 'active' ? 'Active' : 'All'}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          className="h-7 text-text-muted"
        >
          <RefreshCw size={12} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            <LoadingSprite />
          ) : visible.length === 0 ? (
            <EmptyState
              variant="quiet"
              title={filter === 'active' ? 'No active announcements.' : 'No announcements yet.'}
              spriteSize="md"
              padding="sm"
            />
          ) : (
            visible.map(item => (
              <AnnouncementRow key={item.id} item={item} onRetracted={load} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
