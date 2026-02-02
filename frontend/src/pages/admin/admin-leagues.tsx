import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { leagues } from '@/mocks/leagues';
import { DEFAULT_LEAGUE_CONFIG } from '@/lib/types';
import { toast } from 'sonner';
import { Save, Users, Calendar, Trophy, Swords } from 'lucide-react';

interface LeagueSettings {
  pointCap: number;
  teraCaptainSlots: number;
  tradeDeadlineWeek: number;
  maxTeams: number;
  rosterSize: number;
}

const defaultSettings: LeagueSettings = {
  pointCap: DEFAULT_LEAGUE_CONFIG.pointCap,
  teraCaptainSlots: DEFAULT_LEAGUE_CONFIG.teraCaptainSlots,
  tradeDeadlineWeek: 8,
  maxTeams: 12,
  rosterSize: 11,
};

const phaseLabels: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'text-draw bg-draw/10 border-draw/30' },
  regular: { label: 'Regular Season', color: 'text-neon bg-neon/10 border-neon/30' },
  playoffs: { label: 'Playoffs', color: 'text-pink bg-pink/10 border-pink/30' },
  offseason: { label: 'Offseason', color: 'text-text-muted bg-surface-overlay border-border-default' },
};

export function AdminLeagues() {
  const [settings, setSettings] = useState<Record<string, LeagueSettings>>(
    Object.fromEntries(leagues.map(l => [l.id, { ...defaultSettings }]))
  );

  function updateSetting(leagueId: string, key: keyof LeagueSettings, value: number) {
    setSettings(prev => ({
      ...prev,
      [leagueId]: { ...prev[leagueId], [key]: value },
    }));
  }

  function handleSave(leagueId: string) {
    toast.success(`Settings saved for ${leagues.find(l => l.id === leagueId)?.name}`);
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
          <span className="text-text-primary font-medium">10</span>
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
          const phase = phaseLabels[league.season.phase];
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
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Trophy size={10} /> Point Cap
                    </label>
                    <Input
                      type="number"
                      value={s.pointCap}
                      onChange={e => updateSetting(league.id, 'pointCap', Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Swords size={10} /> Tera Captains
                    </label>
                    <Input
                      type="number"
                      value={s.teraCaptainSlots}
                      onChange={e => updateSetting(league.id, 'teraCaptainSlots', Number(e.target.value))}
                      min={0}
                      max={6}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Calendar size={10} /> Trade Deadline
                    </label>
                    <Input
                      type="number"
                      value={s.tradeDeadlineWeek}
                      onChange={e => updateSetting(league.id, 'tradeDeadlineWeek', Number(e.target.value))}
                      min={1}
                      max={league.season.totalWeeks}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Users size={10} /> Max Teams
                    </label>
                    <Input
                      type="number"
                      value={s.maxTeams}
                      onChange={e => updateSetting(league.id, 'maxTeams', Number(e.target.value))}
                      min={2}
                      max={20}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      Roster Size
                    </label>
                    <Input
                      type="number"
                      value={s.rosterSize}
                      onChange={e => updateSetting(league.id, 'rosterSize', Number(e.target.value))}
                      min={6}
                      max={20}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-subtle">
                  <div className="text-xs text-text-muted">
                    {league.players.length} players registered
                    {!league.hasData && ' · No data yet'}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(league.id)}
                    className="bg-neon text-surface-base hover:bg-neon/90"
                  >
                    <Save size={14} />
                    Save
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
