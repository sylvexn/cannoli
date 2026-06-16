/**
 * AdminAnnouncements — entry tab for the Announcements admin section.
 *
 * Two top-level shadcn Tabs:
 *   Compose — compose/edit form + announcement list (active/all filter)
 *   Sent Log — unified notification delivery log
 */
import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api, type ApiAnnouncement } from '@/lib/api';
import { RefreshCw } from 'lucide-react';
import { ComposeForm } from './compose-form';
import { AnnouncementRow } from './announcement-row';
import { SentLog } from './sent-log';

export function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState<ApiAnnouncement[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState<'active' | 'all'>('active');
  const [editing, setEditing]             = useState<ApiAnnouncement | null>(null);

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

  function handleSaved() {
    setEditing(null);
    load();
  }

  function handleCancelEdit() {
    setEditing(null);
  }

  return (
    <Tabs defaultValue="compose" className="space-y-4">
      <TabsList className="h-8">
        <TabsTrigger value="compose" className="text-xs h-7 px-3">Compose</TabsTrigger>
        <TabsTrigger value="sent-log" className="text-xs h-7 px-3">Sent Log</TabsTrigger>
      </TabsList>

      {/* ── Compose tab ─────────────────────────────────────────────────── */}
      <TabsContent value="compose" className="space-y-5 mt-0">
        <ComposeForm
          editing={editing}
          onSaved={handleSaved}
          onCancelEdit={handleCancelEdit}
        />

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
                <AnnouncementRow
                  key={item.id}
                  item={item}
                  onEdit={setEditing}
                  onRetracted={load}
                />
              ))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Sent Log tab ─────────────────────────────────────────────────── */}
      <TabsContent value="sent-log" className="mt-0">
        <SentLog />
      </TabsContent>
    </Tabs>
  );
}
