/**
 * ComposeForm — create or edit an announcement.
 * Handles title/body/link/category/surface/leagueId/targetRole fields,
 * create vs update mode, and a live preview panel beside the form.
 */
import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type ApiAnnouncement, type AnnouncementCategory, type AnnouncementSurface } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { ANNOUNCEMENT_CATEGORY_META, ANNOUNCEMENT_CATEGORIES } from '@/lib/constants';
import { Megaphone } from 'lucide-react';
import { ComposePreview } from './banner-preview';

// Defaults

const DEFAULT_CATEGORY: AnnouncementCategory = 'info';
const DEFAULT_SURFACE: AnnouncementSurface   = 'bell';

interface ComposeFormProps {
  editing: ApiAnnouncement | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}

export function ComposeForm({ editing, onSaved, onCancelEdit }: ComposeFormProps) {
  const { leagues } = useAppData();

  const [title,      setTitle]      = useState('');
  const [body,       setBody]       = useState('');
  const [link,       setLink]       = useState('');
  const [category,   setCategory]   = useState<AnnouncementCategory>(DEFAULT_CATEGORY);
  const [surface,    setSurface]    = useState<AnnouncementSurface>(DEFAULT_SURFACE);
  const [leagueId,   setLeagueId]   = useState<string>('all');   // 'all' → null
  const [targetRole, setTargetRole] = useState<string>('all');   // 'all' → null, 'admin', 'user'
  const [busy,       setBusy]       = useState(false);

  // Sync form when editing object changes
  useEffect(() => {
    if (editing) {
      setTitle(editing.title);
      setBody(editing.body);
      setLink(editing.link ?? '');
      setCategory(editing.category);
      setSurface(editing.surface);
      setLeagueId(editing.leagueId ?? 'all');
      setTargetRole(editing.targetRole ?? 'all');
    } else {
      setTitle('');
      setBody('');
      setLink('');
      setCategory(DEFAULT_CATEGORY);
      setSurface(DEFAULT_SURFACE);
      setLeagueId('all');
      setTargetRole('all');
    }
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleTrimmed = title.trim();
  const bodyTrimmed  = body.trim();
  const canSubmit    = titleTrimmed.length > 0 && bodyTrimmed.length > 0 && !busy;

  const resolvedLeagueId   = leagueId   === 'all' ? null : leagueId;
  const resolvedTargetRole = targetRole === 'all' ? null : (targetRole as 'admin' | 'user');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    try {
      const fields = {
        title:      titleTrimmed,
        body:       bodyTrimmed,
        link:       link.trim() || undefined,
        category,
        surface,
        leagueId:   resolvedLeagueId,
        targetRole: resolvedTargetRole,
      };

      if (editing) {
        await api.updateAnnouncement(editing.id, {
          ...fields,
          link: link.trim() || null,
        });
        toast.success('Announcement updated');
      } else {
        await api.createAnnouncement(fields);
        toast.success('Announcement posted');
        // Reset only on create
        setTitle('');
        setBody('');
        setLink('');
        setCategory(DEFAULT_CATEGORY);
        setSurface(DEFAULT_SURFACE);
        setLeagueId('all');
        setTargetRole('all');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? (editing ? 'Failed to update' : 'Failed to post announcement'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <Megaphone size={14} className="text-neon" />
          {editing ? 'Edit Announcement' : 'New Announcement'}
        </h3>

        {/* 2-col on wide: form left, preview right */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Row 1: Title + Category */}
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
                    {ANNOUNCEMENT_CATEGORIES.map(cat => {
                      const m = ANNOUNCEMENT_CATEGORY_META[cat];
                      const CatIcon = m.Icon;
                      return (
                        <SelectItem key={cat} value={cat}>
                          <CatIcon size={12} />
                          {m.label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: Surface + League + Role */}
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <div className="w-full sm:w-40 shrink-0">
                <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
                  Surface
                </label>
                <Select value={surface} onValueChange={v => setSurface(v as AnnouncementSurface)}>
                  <SelectTrigger size="sm" className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bell">Notification bell</SelectItem>
                    <SelectItem value="banner">Site banner</SelectItem>
                    <SelectItem value="both">Bell + banner</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[130px]">
                <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
                  League
                </label>
                <Select value={leagueId} onValueChange={v => setLeagueId(v ?? 'all')}>
                  <SelectTrigger size="sm" className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All leagues</SelectItem>
                    {leagues.map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full shrink-0 inline-block"
                            style={{ backgroundColor: l.color }}
                          />
                          {l.name.replace(' League', '')}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[130px]">
                <label className="text-[10px] uppercase tracking-wider text-text-muted mb-1 block">
                  Audience
                </label>
                <Select value={targetRole} onValueChange={v => setTargetRole(v ?? 'all')}>
                  <SelectTrigger size="sm" className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="admin">Admins</SelectItem>
                    <SelectItem value="user">Members</SelectItem>
                  </SelectContent>
                </Select>
                {resolvedLeagueId && (
                  <p className="text-[9px] text-text-muted/60 mt-0.5 leading-tight">
                    League targeting already limits to that league's coaches.
                  </p>
                )}
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

            {/* Link (optional) */}
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

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancelEdit}
                  disabled={busy}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit}
                className="h-8 text-xs"
              >
                {busy
                  ? (editing ? 'Saving…' : 'Posting…')
                  : (editing ? 'Save changes' : 'Post announcement')}
              </Button>
            </div>
          </form>

          {/* Live preview */}
          <ComposePreview
            title={title}
            body={body}
            link={link.trim() || null}
            category={category}
            surface={surface}
          />
        </div>
      </CardContent>
    </Card>
  );
}
