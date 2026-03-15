import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api, type ApiUserPreferences } from '@/lib/api';
import { Sliders, Bell, Eye } from 'lucide-react';
import { DEFAULT_LANDING_OPTIONS } from '@/lib/constants';

const DEFAULTS: ApiUserPreferences = {
  theme: 'dark',
  density: 'comfortable',
  defaultLandingPath: '/',
  notifyTrades: true,
  notifyMatches: true,
  notifyAnnouncements: true,
  updatedAt: null,
};

export function PreferencesTab() {
  const [server, setServer] = useState<ApiUserPreferences>(DEFAULTS);
  const [draft, setDraft] = useState<ApiUserPreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getMyPreferences()
      .then(p => { setServer(p); setDraft(p); })
      .catch(err => toast.error(err.message || 'Failed to load preferences'))
      .finally(() => setLoading(false));
  }, []);

  const dirty =
    draft.theme !== server.theme ||
    draft.density !== server.density ||
    draft.defaultLandingPath !== server.defaultLandingPath;

  function patch<K extends keyof ApiUserPreferences>(key: K, value: ApiUserPreferences[K]) {
    setDraft(d => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await api.updateMyPreferences({
        theme: draft.theme,
        density: draft.density,
        defaultLandingPath: draft.defaultLandingPath,
      });
      setServer(draft);
      toast.success('Preferences saved');
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Appearance card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye size={16} />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Theme</label>
              <Select
                value={draft.theme}
                onValueChange={(v) => v && patch('theme', v as 'dark' | 'light')}
                disabled={loading}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light" disabled>Light (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-muted">Density</label>
              <Select
                value={draft.density}
                onValueChange={(v) => v && patch('density', v as 'compact' | 'comfortable')}
                disabled={loading}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-text-muted">Default landing page</label>
            <Select
              value={draft.defaultLandingPath}
              onValueChange={(v) => v && patch('defaultLandingPath', v as string)}
              disabled={loading}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEFAULT_LANDING_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-muted">Where you land when you visit Cannoli without a path.</p>
          </div>
        </CardContent>
      </Card>

      {/* Notifications card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell size={16} />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] text-text-muted">
            Notification delivery is coming soon — these toggles will become live in a future update.
          </p>

          <NotifyRow label="Trade activity" description="Proposals, accepts, and rejections involving your team."
            checked={draft.notifyTrades} disabled />
          <NotifyRow label="Match readiness" description="Match readying, completion, and replay availability."
            checked={draft.notifyMatches} disabled />
          <NotifyRow label="Site announcements" description="Admin-posted announcements and league-wide news."
            checked={draft.notifyAnnouncements} disabled />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-surface-base/80 backdrop-blur-sm border-t border-border-subtle flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-text-muted">Unsaved changes</span>}
        <Button
          onClick={save}
          disabled={!dirty || saving || loading}
          className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-40"
        >
          <Sliders size={14} className="mr-1.5" />
          {saving ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </div>
  );
}

function NotifyRow({ label, description, checked, disabled }: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-subtle last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        <div className="text-[11px] text-text-muted">{description}</div>
      </div>
      <Switch checked={checked} disabled={disabled} />
    </div>
  );
}
