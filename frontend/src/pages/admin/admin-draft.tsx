import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { LoadingSprite } from '@/components/loading-sprite';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Save, Timer, Zap } from 'lucide-react';

export function AdminDraft() {
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [demoVisible, setDemoVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSiteSettings().then(s => {
      setTimerEnabled(s.draftTimerEnabled ?? true);
      setDemoVisible(s.draftDemoVisible ?? true);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      // Fetch current settings, merge draft fields, save
      const current = await api.getSiteSettings();
      await api.saveSiteSettings({
        siteName: current.siteName,
        announcementEnabled: !!current.announcement,
        announcementText: current.announcement || '',
        announcementType: current.announcementType || 'info',
        defaultPointCap: current.defaultPointCap,
        defaultTeraCaptainSlots: current.defaultTeraCaptainSlots,
        defaultTradeDeadlineWeek: current.defaultTradeDeadlineWeek,
        defaultRosterSize: current.defaultRosterSize,
        defaultMaxTeams: current.defaultMaxTeams,
        draftTimerEnabled: timerEnabled,
        draftDemoVisible: demoVisible,
      });
      toast.success('Draft settings saved');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingSprite />;
  }

  return (
    <div className="space-y-4 max-w-lg">
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading flex items-center gap-2">
            <Timer size={14} className="text-draw" />
            Draft Timer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Enable pick timer</div>
              <div className="text-[11px] text-text-muted">When disabled, players have unlimited time per pick</div>
            </div>
            <Switch checked={timerEnabled} onCheckedChange={setTimerEnabled} />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-heading flex items-center gap-2">
            <Zap size={14} className="text-pink" />
            Demo Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary">Show demo mode on draft board</div>
              <div className="text-[11px] text-text-muted">When hidden, only Season and Live modes are available</div>
            </div>
            <Switch checked={demoVisible} onCheckedChange={setDemoVisible} />
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-neon text-surface-base hover:bg-neon/90 gap-1.5"
      >
        <Save size={14} />
        {saving ? 'Saving...' : 'Save Draft Settings'}
      </Button>
    </div>
  );
}
