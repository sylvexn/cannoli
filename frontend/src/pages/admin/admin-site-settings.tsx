import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/errors';
import {
  Save, Megaphone, Settings,
  Zap, Loader2,
} from 'lucide-react';

interface AllSettings {
  announcementEnabled: boolean;
  announcementText: string;
  announcementType: 'info' | 'warning' | 'success';
  defaultUserPassword: string;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
}

const INITIAL: AllSettings = {
  announcementEnabled: false,
  announcementText: '',
  announcementType: 'info',
  defaultUserPassword: 'password',
  draftTimerEnabled: true,
  draftDemoVisible: true,
};

const announcementTypes = [
  { value: 'info', label: 'Info', color: 'text-neon border-neon/30 bg-neon/10' },
  { value: 'warning', label: 'Warning', color: 'text-draw border-draw/30 bg-draw/10' },
  { value: 'success', label: 'Success', color: 'text-win border-win/30 bg-win/10' },
] as const;

export function AdminSiteSettings() {
  const [settings, setSettings] = useState<AllSettings>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSiteSettings()
      .then(s => {
        setSettings({
          announcementEnabled: !!s.announcement,
          announcementText: s.announcement ?? '',
          announcementType: (s.announcementType as AllSettings['announcementType']) ?? 'info',
          defaultUserPassword: s.defaultUserPassword ?? 'password',
          draftTimerEnabled: s.draftTimerEnabled ?? true,
          draftDemoVisible: s.draftDemoVisible ?? true,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof AllSettings>(key: K, value: AllSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.saveSiteSettings(settings as unknown as Record<string, unknown>);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingSprite label="Loading settings..." />;
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ─── General ──────────────────────────────────────────── */}
      <div>
        <SubHeader icon={Settings} label="General" />
        <div className="space-y-4 mt-3">
          <Field label="Default User Password" hint="New accounts and password resets use this. Users must change on first login.">
            <Input
              value={settings.defaultUserPassword}
              onChange={e => update('defaultUserPassword', e.target.value)}
              placeholder="password"
              className="max-w-xs font-mono"
            />
          </Field>
        </div>
      </div>

      {/* ─── Announcement ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between">
          <SubHeader icon={Megaphone} label="Announcement Banner" />
          <Switch
            checked={settings.announcementEnabled}
            onCheckedChange={v => update('announcementEnabled', v)}
          />
        </div>
        {settings.announcementEnabled && (
          <div className="space-y-4 mt-3">
            <Field label="Message">
              <Input
                value={settings.announcementText}
                onChange={e => update('announcementText', e.target.value)}
                placeholder="e.g. Draft night is Saturday at 7pm EST!"
              />
            </Field>
            <Field label="Type">
              <div className="flex gap-2">
                {announcementTypes.map(t => (
                  <button key={t.value} onClick={() => update('announcementType', t.value)} className="outline-none">
                    <Badge
                      variant="outline"
                      className={cn(
                        'cursor-pointer transition-colors',
                        settings.announcementType === t.value
                          ? `${t.color} ring-1 ring-current`
                          : 'text-text-muted border-border',
                      )}
                    >
                      {t.label}
                    </Badge>
                  </button>
                ))}
              </div>
            </Field>
            {settings.announcementText && (
              <Field label="Preview">
                <div className={cn(
                  'rounded-lg border px-4 py-2.5 text-sm',
                  settings.announcementType === 'info' ? 'border-neon/30 bg-neon/5 text-neon'
                    : settings.announcementType === 'warning' ? 'border-draw/30 bg-draw/5 text-draw'
                    : 'border-win/30 bg-win/5 text-win',
                )}>
                  <Megaphone size={14} className="inline-block mr-2 -mt-0.5" />
                  {settings.announcementText}
                </div>
              </Field>
            )}
          </div>
        )}
      </div>

      {/* ─── Draft ────────────────────────────────────────────── */}
      <div>
        <SubHeader icon={Zap} label="Draft" />
        <div className="space-y-4 mt-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Enable pick timer</div>
              <div className="text-[11px] text-text-muted">When disabled, players have unlimited time per pick</div>
            </div>
            <Switch checked={settings.draftTimerEnabled} onCheckedChange={v => update('draftTimerEnabled', v)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Show demo mode</div>
              <div className="text-[11px] text-text-muted">When hidden, only Season and Live modes are available on draft board</div>
            </div>
            <Switch checked={settings.draftDemoVisible} onCheckedChange={v => update('draftDemoVisible', v)} />
          </div>
        </div>
      </div>

      {/* ─── Save ─────────────────────────────────────────────── */}
      <div className="flex justify-end pt-2 border-t border-border-subtle">
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-neon text-surface-base hover:bg-neon/90 gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

function SubHeader({ icon: Icon, label }: { icon: typeof Settings; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} className="text-text-muted" />
      <h3 className="text-xs font-heading font-semibold text-text-muted uppercase tracking-wider">{label}</h3>
    </div>
  );
}

function Field({ label, hint, children, icon: Icon }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  icon?: typeof Settings;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-muted flex items-center gap-1">
        {Icon && <Icon size={10} />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-text-muted">{hint}</p>}
    </div>
  );
}
