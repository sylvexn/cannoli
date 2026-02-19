import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Save, Megaphone, Settings, Trophy, Swords, Users,
  Timer, Zap, Shield, Loader2,
} from 'lucide-react';

interface AllSettings {
  siteName: string;
  announcementEnabled: boolean;
  announcementText: string;
  announcementType: 'info' | 'warning' | 'success';
  defaultPointCap: number;
  defaultTeraCaptainSlots: number;
  defaultMaxTeams: number;
  defaultRosterSize: number;
  defaultTradeDeadlineWeek: number;
  defaultUserPassword: string;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
}

const INITIAL: AllSettings = {
  siteName: 'Cannoli',
  announcementEnabled: false,
  announcementText: '',
  announcementType: 'info',
  defaultPointCap: 110,
  defaultTeraCaptainSlots: 2,
  defaultMaxTeams: 12,
  defaultRosterSize: 10,
  defaultTradeDeadlineWeek: 7,
  defaultUserPassword: 'password',
  draftTimerEnabled: true,
  draftDemoVisible: true,
};

const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'announcement', label: 'Announcement', icon: Megaphone },
  { id: 'league', label: 'League Defaults', icon: Trophy },
  { id: 'draft', label: 'Draft', icon: Zap },
] as const;

const announcementTypes = [
  { value: 'info', label: 'Info', color: 'text-neon border-neon/30 bg-neon/10' },
  { value: 'warning', label: 'Warning', color: 'text-draw border-draw/30 bg-draw/10' },
  { value: 'success', label: 'Success', color: 'text-win border-win/30 bg-win/10' },
] as const;

export function AdminSiteSettings() {
  const [settings, setSettings] = useState<AllSettings>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('general');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    api.getSiteSettings()
      .then(s => {
        setSettings({
          siteName: s.siteName ?? 'Cannoli',
          announcementEnabled: !!s.announcement,
          announcementText: s.announcement ?? '',
          announcementType: (s.announcementType as AllSettings['announcementType']) ?? 'info',
          defaultPointCap: s.defaultPointCap ?? 110,
          defaultTeraCaptainSlots: s.defaultTeraCaptainSlots ?? 2,
          defaultMaxTeams: s.defaultMaxTeams ?? 12,
          defaultRosterSize: s.defaultRosterSize ?? 10,
          defaultTradeDeadlineWeek: s.defaultTradeDeadlineWeek ?? 7,
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
      await api.saveSiteSettings(settings);
      toast.success('Settings saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function scrollTo(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loading) {
    return <div className="text-sm text-text-muted py-8 text-center">Loading settings...</div>;
  }

  return (
    <div className="flex gap-6">
      {/* Section nav */}
      <nav className="w-[140px] shrink-0 sticky top-4 self-start space-y-0.5">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] transition-colors',
                activeSection === s.id
                  ? 'bg-surface-overlay text-text-primary font-medium'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40',
              )}
            >
              <Icon size={13} className={activeSection === s.id ? 'text-neon' : ''} />
              {s.label}
            </button>
          );
        })}

        <div className="pt-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-neon text-surface-base hover:bg-neon/90 gap-1.5 text-xs"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </nav>

      {/* Settings content */}
      <div className="flex-1 min-w-0 space-y-8 max-w-2xl">

        {/* ─── General ──────────────────────────────────────────── */}
        <section ref={el => { sectionRefs.current.general = el; }}>
          <SectionHeader icon={Settings} label="General" />
          <div className="space-y-4 mt-3">
            <Field label="Site Name">
              <Input
                value={settings.siteName}
                onChange={e => update('siteName', e.target.value)}
                className="max-w-xs"
              />
            </Field>
            <Field label="Default User Password" hint="New accounts and password resets use this. Users must change on first login.">
              <Input
                value={settings.defaultUserPassword}
                onChange={e => update('defaultUserPassword', e.target.value)}
                placeholder="password"
                className="max-w-xs font-mono"
              />
            </Field>
          </div>
        </section>

        {/* ─── Announcement ─────────────────────────────────────── */}
        <section ref={el => { sectionRefs.current.announcement = el; }}>
          <div className="flex items-center justify-between">
            <SectionHeader icon={Megaphone} label="Announcement Banner" />
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
        </section>

        {/* ─── League Defaults ──────────────────────────────────── */}
        <section ref={el => { sectionRefs.current.league = el; }}>
          <SectionHeader icon={Trophy} label="League Defaults" />
          <p className="text-[11px] text-text-muted mt-1 mb-3">
            Default values for new leagues/seasons. Individual leagues can override.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Point Cap" inline icon={Shield}>
              <NumberInput value={settings.defaultPointCap} onChange={v => update('defaultPointCap', v)} min={50} max={200} />
            </Field>
            <Field label="Tera Captain Slots" inline icon={Swords}>
              <NumberInput value={settings.defaultTeraCaptainSlots} onChange={v => update('defaultTeraCaptainSlots', v)} min={0} max={6} />
            </Field>
            <Field label="Max Teams" inline icon={Users}>
              <NumberInput value={settings.defaultMaxTeams} onChange={v => update('defaultMaxTeams', v)} min={2} max={20} />
            </Field>
            <Field label="Roster Size" inline>
              <NumberInput value={settings.defaultRosterSize} onChange={v => update('defaultRosterSize', v)} min={6} max={20} />
            </Field>
            <Field label="Trade Deadline Week" inline>
              <NumberInput value={settings.defaultTradeDeadlineWeek} onChange={v => update('defaultTradeDeadlineWeek', v)} min={1} max={30} />
            </Field>
          </div>
        </section>

        {/* ─── Draft ────────────────────────────────────────────── */}
        <section ref={el => { sectionRefs.current.draft = el; }}>
          <SectionHeader icon={Zap} label="Draft" />
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
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: typeof Settings; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-border-subtle">
      <Icon size={15} className="text-text-muted" />
      <h3 className="text-sm font-heading font-semibold text-text-primary uppercase tracking-wider">{label}</h3>
    </div>
  );
}

function Field({ label, hint, children, inline, icon: Icon }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  inline?: boolean;
  icon?: typeof Settings;
}) {
  return (
    <div className={inline ? 'space-y-1' : 'space-y-1'}>
      <label className="text-xs text-text-muted flex items-center gap-1">
        {Icon && <Icon size={10} />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-text-muted">{hint}</p>}
    </div>
  );
}
