import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { toast } from 'sonner';
import { api, type ApiUserPreferences } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Sliders, Eye, Globe, ChevronsUpDown } from 'lucide-react';
import { DEFAULT_LANDING_OPTIONS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';

const DEFAULTS: ApiUserPreferences = {
  theme: 'dark',
  density: 'comfortable',
  defaultLandingPath: '/',
  timezone: null,
  colorblindMode: false,
  spoilerFreeMode: false,
  updatedAt: null,
};

function listIanaZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') return supported('timeZone');
  } catch { /* fall through */ }
  return ['UTC'];
}

export function PreferencesTab() {
  const { refreshPreferences } = useAuth();
  const [server, setServer] = useState<ApiUserPreferences>(DEFAULTS);
  const [draft, setDraft] = useState<ApiUserPreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getMyPreferences()
      .then(p => { setServer(p); setDraft(p); })
      .catch(err => toast.error(getErrorMessage(err, 'Failed to load preferences')))
      .finally(() => setLoading(false));
  }, []);

  const dirty =
    draft.theme !== server.theme ||
    draft.density !== server.density ||
    draft.defaultLandingPath !== server.defaultLandingPath ||
    draft.timezone !== server.timezone ||
    draft.colorblindMode !== server.colorblindMode ||
    draft.spoilerFreeMode !== server.spoilerFreeMode;

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
        timezone: draft.timezone,
        colorblindMode: draft.colorblindMode,
        spoilerFreeMode: draft.spoilerFreeMode,
      });
      setServer(draft);
      toast.success('Preferences saved');
      // Always refresh — picks up timezone + colorblind in one round-trip and
      // re-stamps <html data-colorblind> via AuthProvider's effect.
      await refreshPreferences();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
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

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-border-subtle">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">Colorblind mode</div>
              <div className="text-[11px] text-text-muted">
                Swaps the red/green win/loss palette to a deuteranopia-safe orange/blue pairing.
                Affects standings, replays, and the matchup-center type chart.
              </div>
            </div>
            <Switch
              checked={draft.colorblindMode}
              onCheckedChange={(v) => patch('colorblindMode', v)}
              disabled={loading}
            />
          </div>

          <div className="flex items-start justify-between gap-4 pt-2 border-t border-border-subtle">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary">Spoiler-free mode</div>
              <div className="text-[11px] text-text-muted">
                Hides match results — scores, winners, and result badges — on the standings and
                replays pages behind a click-to-reveal blur. Reveal resets each visit.
              </div>
            </div>
            <Switch
              checked={draft.spoilerFreeMode}
              onCheckedChange={(v) => patch('spoilerFreeMode', v)}
              disabled={loading}
            />
          </div>
        </CardContent>
      </Card>

      {/* Timezone card */}
      <TimezoneCard
        value={draft.timezone}
        onChange={(tz) => patch('timezone', tz)}
        loading={loading}
      />

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

function TimezoneCard({
  value, onChange, loading,
}: {
  value: string | null;
  onChange: (tz: string | null) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const browserZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const zones = useMemo(listIanaZones, []);
  const effective = value ?? browserZone;
  const isExplicit = value != null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe size={16} />
          Timezone
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-text-muted">
          All timestamps across Cannoli render in this zone. Storage stays in UTC; this is just how dates look to you.
        </p>

        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              disabled={loading}
              className={cn(
                'flex h-8 flex-1 items-center justify-between rounded-md border border-input bg-background px-3 text-sm',
                'disabled:opacity-50',
              )}
            >
              <span className="truncate">
                {effective}
                {!isExplicit && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-text-muted">
                    (browser default)
                  </span>
                )}
              </span>
              <ChevronsUpDown size={14} className="ml-2 shrink-0 opacity-50" />
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search zones…" />
                <CommandList>
                  <CommandEmpty>No matching zone.</CommandEmpty>
                  {zones.map(z => (
                    <CommandItem
                      key={z}
                      value={z}
                      onSelect={(v) => { onChange(v); setOpen(false); }}
                      data-checked={z === value ? 'true' : undefined}
                    >
                      {z}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <Button
            variant="outline"
            size="sm"
            disabled={loading || !isExplicit}
            onClick={() => onChange(null)}
          >
            Match my browser
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

