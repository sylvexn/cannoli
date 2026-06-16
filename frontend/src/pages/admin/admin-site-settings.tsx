import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import {
  Save, Settings,
  Zap, Loader2,
} from 'lucide-react';

interface AllSettings {
  defaultUserPassword: string;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
}

const INITIAL: AllSettings = {
  defaultUserPassword: 'password',
  draftTimerEnabled: true,
  draftDemoVisible: true,
};

export function AdminSiteSettings() {
  const [settings, setSettings] = useState<AllSettings>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSiteSettings()
      .then(s => {
        setSettings({
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
