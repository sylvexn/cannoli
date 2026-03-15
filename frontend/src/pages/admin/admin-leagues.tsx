import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Save, Users, Calendar, Trophy, Swords, Lock } from 'lucide-react';

interface LeagueSettings {
  pointCap: number;
  teraCaptainSlots: number;
  tradeDeadlineWeek: number;
  maxTeams: number;
  rosterSize: number;
}

const phaseLabels: Record<string, { label: string; color: string }> = {
  predraft: { label: 'Pre-draft', color: 'text-text-muted bg-surface-overlay border-border-default' },
  draft: { label: 'Draft', color: 'text-draw bg-draw/10 border-draw/30' },
  regular: { label: 'Regular Season', color: 'text-neon bg-neon/10 border-neon/30' },
  playoffs: { label: 'Playoffs', color: 'text-pink bg-pink/10 border-pink/30' },
  offseason: { label: 'Offseason', color: 'text-text-muted bg-surface-overlay border-border-default' },
};

interface LockState {
  pointCap: boolean;
  teraCaptainSlots: boolean;
  tradeDeadlineWeek: boolean;
  maxTeams: boolean;
  rosterSize: boolean;
}

function computeLocks(phase: string): LockState {
  // Conservative defaults — see plan §2a phase-aware locks.
  const inOrPastDraft = phase === 'regular' || phase === 'playoffs' || phase === 'offseason';
  return {
    pointCap: inOrPastDraft,
    rosterSize: inOrPastDraft,
    teraCaptainSlots: phase === 'regular' || phase === 'playoffs' || phase === 'offseason',
    tradeDeadlineWeek: phase === 'playoffs' || phase === 'offseason',
    maxTeams: phase !== 'predraft' && phase !== 'draft', // lock once we have teams
  };
}

export function AdminLeagues() {
  const { leagues, refreshLeagues } = useAppData();
  const [settings, setSettings] = useState<Record<string, LeagueSettings>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // Hydrate settings from real league/season data on first load
  useEffect(() => {
    if (leagues.length === 0) return;
    setSettings(prev => {
      const next = { ...prev };
      for (const l of leagues) {
        if (next[l.id]) continue;
        next[l.id] = {
          pointCap: l.season.pointCap ?? 110,
          teraCaptainSlots: l.season.teraCaptainSlots ?? 2,
          tradeDeadlineWeek: l.season.tradeDeadlineWeek ?? 7,
          maxTeams: 12,
          rosterSize: 11,
        };
      }
      return next;
    });
  }, [leagues]);

  function updateSetting(leagueId: string, key: keyof LeagueSettings, value: number) {
    setSettings(prev => ({
      ...prev,
      [leagueId]: { ...prev[leagueId], [key]: value },
    }));
  }

  async function handleSave(leagueId: string) {
    const s = settings[leagueId];
    if (!s) return;
    setSaving(prev => ({ ...prev, [leagueId]: true }));
    try {
      await api.updateLeague(leagueId, {
        pointCap: s.pointCap,
        teraCaptainSlots: s.teraCaptainSlots,
        tradeDeadlineWeek: s.tradeDeadlineWeek,
        maxTeams: s.maxTeams,
        rosterSize: s.rosterSize,
      });
      toast.success(`Saved settings for ${leagues.find(l => l.id === leagueId)?.name}`);
      refreshLeagues();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSaving(prev => ({ ...prev, [leagueId]: false }));
    }
  }

  return (
    <div className="space-y-4">
      {/* Global stats */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Leagues:</span>
          <span className="text-text-primary font-medium">{leagues.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Season:</span>
          <span className="text-text-primary font-medium">
            {leagues[0]?.season.seasonNumber ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total Players:</span>
          <span className="text-text-primary font-medium">
            {leagues.reduce((sum, l) => sum + l.players.length, 0)}
          </span>
        </div>
      </div>

      {/* League cards */}
      <div className="grid gap-4">
        {leagues.map(league => {
          const s = settings[league.id];
          if (!s) return null;
          const phase = phaseLabels[league.season.phase] ?? phaseLabels.offseason;
          const locks = computeLocks(league.season.phase);
          return (
            <Card key={league.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: league.color }}
                    />
                    {league.name}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={phase.color}>
                      {phase.label}
                    </Badge>
                    {league.season.phase === 'regular' && (
                      <Badge variant="outline">
                        Week {league.season.currentWeek}/{league.season.totalWeeks}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <SettingField
                    label="Point Cap"
                    icon={<Trophy size={10} />}
                    value={s.pointCap}
                    onChange={v => updateSetting(league.id, 'pointCap', v)}
                    locked={locks.pointCap}
                    lockReason="Locked once draft has begun"
                  />
                  <SettingField
                    label="Tera Captains"
                    icon={<Swords size={10} />}
                    value={s.teraCaptainSlots}
                    onChange={v => updateSetting(league.id, 'teraCaptainSlots', v)}
                    min={0}
                    max={6}
                    locked={locks.teraCaptainSlots}
                    lockReason="Locked once regular season begins"
                  />
                  <SettingField
                    label="Trade Deadline"
                    icon={<Calendar size={10} />}
                    value={s.tradeDeadlineWeek}
                    onChange={v => updateSetting(league.id, 'tradeDeadlineWeek', v)}
                    min={1}
                    max={league.season.totalWeeks}
                    locked={locks.tradeDeadlineWeek}
                    lockReason="Locked after regular season"
                  />
                  <SettingField
                    label="Max Teams"
                    icon={<Users size={10} />}
                    value={s.maxTeams}
                    onChange={v => updateSetting(league.id, 'maxTeams', v)}
                    min={2}
                    max={20}
                    locked={locks.maxTeams}
                    lockReason="Locked once teams exist"
                  />
                  <SettingField
                    label="Roster Size"
                    value={s.rosterSize}
                    onChange={v => updateSetting(league.id, 'rosterSize', v)}
                    min={6}
                    max={20}
                    locked={locks.rosterSize}
                    lockReason="Locked once draft has begun"
                  />
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-subtle">
                  <div className="text-xs text-text-muted">
                    {league.players.length} players registered
                    {!league.hasData && ' · No data yet'}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(league.id)}
                    disabled={saving[league.id]}
                    className="bg-neon text-surface-base hover:bg-neon/90"
                  >
                    <Save size={14} />
                    {saving[league.id] ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SettingField({
  label, icon, value, onChange, min, max, locked, lockReason,
}: {
  label: string;
  icon?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  locked: boolean;
  lockReason: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-muted flex items-center gap-1">
        {icon}
        {label}
        {locked && (
          <span title={lockReason} className="text-text-muted/60">
            <Lock size={9} />
          </span>
        )}
      </label>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        disabled={locked}
      />
    </div>
  );
}
