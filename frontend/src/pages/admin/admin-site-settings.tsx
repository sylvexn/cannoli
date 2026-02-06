import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_LEAGUE_CONFIG } from '@/lib/types';
import { toast } from 'sonner';
import { Save, Megaphone, Settings, Trophy, Swords, Users, ScrollText } from 'lucide-react';

interface SiteSettings {
  siteName: string;
  announcementEnabled: boolean;
  announcementText: string;
  announcementType: 'info' | 'warning' | 'success';
  defaultPointCap: number;
  defaultTeraCaptainSlots: number;
  defaultMaxTeams: number;
  defaultRosterSize: number;
  defaultTotalWeeks: number;
  defaultTradeDeadlineWeek: number;
}

const INITIAL_SETTINGS: SiteSettings = {
  siteName: 'Cannoli',
  announcementEnabled: false,
  announcementText: '',
  announcementType: 'info',
  defaultPointCap: DEFAULT_LEAGUE_CONFIG.pointCap,
  defaultTeraCaptainSlots: DEFAULT_LEAGUE_CONFIG.teraCaptainSlots,
  defaultMaxTeams: 12,
  defaultRosterSize: 11,
  defaultTotalWeeks: 11,
  defaultTradeDeadlineWeek: 8,
};

const announcementTypes = [
  { value: 'info', label: 'Info', color: 'text-neon border-neon/30 bg-neon/10' },
  { value: 'warning', label: 'Warning', color: 'text-draw border-draw/30 bg-draw/10' },
  { value: 'success', label: 'Success', color: 'text-win border-win/30 bg-win/10' },
] as const;

export function AdminSiteSettings() {
  const [settings, setSettings] = useState<SiteSettings>(INITIAL_SETTINGS);

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    toast.success('Site settings saved');
  }

  return (
    <div className="space-y-4">
      {/* General */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings size={14} className="text-text-muted" />
            General
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Site Name</label>
            <Input
              value={settings.siteName}
              onChange={e => update('siteName', e.target.value)}
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Announcement Banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone size={14} className="text-text-muted" />
              Announcement Banner
            </CardTitle>
            <Switch
              checked={settings.announcementEnabled}
              onCheckedChange={v => update('announcementEnabled', v)}
            />
          </div>
        </CardHeader>
        {settings.announcementEnabled && (
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Message</label>
              <Input
                value={settings.announcementText}
                onChange={e => update('announcementText', e.target.value)}
                placeholder="e.g. Draft night is Saturday at 7pm EST!"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Type</label>
              <div className="flex gap-2">
                {announcementTypes.map(t => (
                  <button
                    key={t.value}
                    onClick={() => update('announcementType', t.value)}
                    className="outline-none"
                  >
                    <Badge
                      variant="outline"
                      className={`cursor-pointer transition-colors ${
                        settings.announcementType === t.value
                          ? `${t.color} ring-1 ring-current`
                          : 'text-text-muted border-border'
                      }`}
                    >
                      {t.label}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
            {/* Preview */}
            {settings.announcementText && (
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Preview</label>
                <AnnouncementPreview
                  text={settings.announcementText}
                  type={settings.announcementType}
                />
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* League Defaults */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText size={14} className="text-text-muted" />
            League Defaults
          </CardTitle>
          <p className="text-xs text-text-muted mt-1">
            Default values when creating new leagues or seasons. Individual leagues can override these.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-text-muted flex items-center gap-1">
                <Trophy size={10} /> Point Cap
              </label>
              <Input
                type="number"
                value={settings.defaultPointCap}
                onChange={e => update('defaultPointCap', Number(e.target.value))}
                min={50} max={200}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted flex items-center gap-1">
                <Swords size={10} /> Tera Captain Slots
              </label>
              <Input
                type="number"
                value={settings.defaultTeraCaptainSlots}
                onChange={e => update('defaultTeraCaptainSlots', Number(e.target.value))}
                min={0} max={6}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted flex items-center gap-1">
                <Users size={10} /> Max Teams
              </label>
              <Input
                type="number"
                value={settings.defaultMaxTeams}
                onChange={e => update('defaultMaxTeams', Number(e.target.value))}
                min={2} max={20}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Roster Size</label>
              <Input
                type="number"
                value={settings.defaultRosterSize}
                onChange={e => update('defaultRosterSize', Number(e.target.value))}
                min={6} max={20}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Total Weeks</label>
              <Input
                type="number"
                value={settings.defaultTotalWeeks}
                onChange={e => update('defaultTotalWeeks', Number(e.target.value))}
                min={1} max={30}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Trade Deadline Week</label>
              <Input
                type="number"
                value={settings.defaultTradeDeadlineWeek}
                onChange={e => update('defaultTradeDeadlineWeek', Number(e.target.value))}
                min={1} max={settings.defaultTotalWeeks}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} className="bg-neon text-surface-base hover:bg-neon/90">
          <Save size={14} />
          Save Settings
        </Button>
      </div>
    </div>
  );
}

function AnnouncementPreview({ text, type }: { text: string; type: 'info' | 'warning' | 'success' }) {
  const styles = {
    info: 'border-neon/30 bg-neon/5 text-neon',
    warning: 'border-draw/30 bg-draw/5 text-draw',
    success: 'border-win/30 bg-win/5 text-win',
  };

  return (
    <div className={`rounded-lg border px-4 py-2.5 text-sm ${styles[type]}`}>
      <Megaphone size={14} className="inline-block mr-2 -mt-0.5" />
      {text}
    </div>
  );
}
