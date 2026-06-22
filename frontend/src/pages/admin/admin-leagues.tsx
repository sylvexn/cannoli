import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Save, Calendar, Trophy, Swords, Lock, Pause, AlertTriangle, Trophy as TrophyIcon, Gamepad2,
} from 'lucide-react';
import { DRAFT_FORMATS, type DraftFormat } from '@/data/pokemon-learnsets';
import { getErrorMessage } from '@/lib/errors';
import { ScheduleDatesStep } from './season/schedule-dates-step';

interface LeagueSettings {
  pointCap: number;
  teraCaptainSlots: number;
  tradeDeadlineWeek: number;
  rosterSize: number;
  /** Roster band (min/max a team may hold post-draft). Editable in any phase. */
  minRosterSize: number;
  maxRosterSize: number;
  playoffTeamCount: number;
  paused: boolean;
  forfeitPolicy: 'double_forfeit' | 'admin_review';
  format: DraftFormat;
}

const FORMAT_LABELS: Record<DraftFormat, string> = {
  gen9natdex: 'Gen 9 NatDex',
  gen9ou: 'Gen 9 OU',
  gen9uu: 'Gen 9 UU',
  gen9ru: 'Gen 9 RU',
  gen9nu: 'Gen 9 NU',
  gen9pu: 'Gen 9 PU',
  gen9lc: 'Gen 9 LC',
  gen9ubers: 'Gen 9 Ubers',
};

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
  rosterSize: boolean;
  playoffTeamCount: boolean;
}

function computeLocks(phase: string): LockState {
  // Conservative defaults — see plan §2a phase-aware locks.
  const inOrPastDraft = phase === 'regular' || phase === 'playoffs' || phase === 'offseason';
  return {
    pointCap: inOrPastDraft,
    rosterSize: inOrPastDraft,
    teraCaptainSlots: phase === 'regular' || phase === 'playoffs' || phase === 'offseason',
    tradeDeadlineWeek: phase === 'playoffs' || phase === 'offseason',
    // playoffTeamCount lock is enforced server-side once a bracket exists, but
    // we soft-lock here at offseason to discourage post-hoc edits.
    playoffTeamCount: phase === 'offseason',
  };
}

export function AdminLeagues() {
  const { leagues, refreshLeagues } = useAppData();
  const [settings, setSettings] = useState<Record<string, LeagueSettings>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Per-league: { actual: total captains assigned, expected: teamCount * cap }
  const [captainStats, setCaptainStats] = useState<Record<string, { actual: number; expected: number }>>({});
  // Week-dates editor: keyed by league id
  const [weekDatesOpen, setWeekDatesOpen] = useState<Record<string, boolean>>({});
  const [weekDatesEdit, setWeekDatesEdit] = useState<Record<string, Record<string, string>>>({});
  const [weekDatesSaving, setWeekDatesSaving] = useState<Record<string, boolean>>({});

  // Surface drift between configured Tera Captain slots and the number of
  // captains actually flagged on team rosters. Pulls each league's teams +
  // rosters once; cap × team_count gives the expected total.
  useEffect(() => {
    let cancelled = false;
    if (leagues.length === 0) return;
    Promise.all(
      leagues.map(async l => {
        const teams = await api.getTeams(l.id).catch(() => []);
        const cap = l.season?.teraCaptainSlots ?? 0;
        let actual = 0;
        for (const t of teams) {
          for (const r of t.roster) {
            if (r.isTeraCaptain) actual += 1;
          }
        }
        return [l.id, { actual, expected: cap * teams.length }] as const;
      }),
    ).then(rows => {
      if (cancelled) return;
      setCaptainStats(Object.fromEntries(rows));
    });
    return () => { cancelled = true; };
  }, [leagues]);

  // Hydrate settings from real league/season data on first load.
  // rosterSize: backend column was added by agent 3; if missing, we still
  // surface the input and the PUT handler will accept once the merge lands.
  useEffect(() => {
    if (leagues.length === 0) return;
    setSettings(prev => {
      const next = { ...prev };
      for (const l of leagues) {
        if (next[l.id]) continue;
        const baseRoster = l.season.rosterSize ?? 11;
        next[l.id] = {
          pointCap: l.season.pointCap ?? 110,
          teraCaptainSlots: l.season.teraCaptainSlots ?? 2,
          tradeDeadlineWeek: l.season.tradeDeadlineWeek ?? 7,
          rosterSize: baseRoster,
          // Roster band — null in the API means "no band"; show rosterSize so the
          // inputs aren't empty (saving these establishes an explicit band).
          minRosterSize: l.season.minRosterSize ?? baseRoster,
          maxRosterSize: l.season.maxRosterSize ?? baseRoster,
          playoffTeamCount: l.playoffTeamCount ?? 6,
          paused: !!l.season.paused,
          forfeitPolicy: l.season.forfeitPolicy ?? 'double_forfeit',
          format: (l.format ?? 'gen9natdex') as DraftFormat,
        };
      }
      return next;
    });
  }, [leagues]);

  function updateSetting<K extends keyof LeagueSettings>(leagueId: string, key: K, value: LeagueSettings[K]) {
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
        rosterSize: s.rosterSize,
        minRosterSize: s.minRosterSize,
        maxRosterSize: s.maxRosterSize,
        playoffTeamCount: s.playoffTeamCount,
        paused: s.paused,
        forfeitPolicy: s.forfeitPolicy,
        format: s.format,
      });
      toast.success(`Saved settings for ${leagues.find(l => l.id === leagueId)?.name}`);
      refreshLeagues();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(prev => ({ ...prev, [leagueId]: false }));
    }
  }

  function openWeekDates(leagueId: string) {
    const league = leagues.find(l => l.id === leagueId);
    const existing = league?.season?.weekDates ?? {};
    setWeekDatesEdit(prev => ({ ...prev, [leagueId]: { ...existing } }));
    setWeekDatesOpen(prev => ({ ...prev, [leagueId]: true }));
  }

  async function saveWeekDates(leagueId: string) {
    const dates = weekDatesEdit[leagueId] ?? {};
    setWeekDatesSaving(prev => ({ ...prev, [leagueId]: true }));
    try {
      await api.updateLeague(leagueId, { weekDates: dates });
      toast.success('Week dates saved');
      refreshLeagues();
      setWeekDatesOpen(prev => ({ ...prev, [leagueId]: false }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setWeekDatesSaving(prev => ({ ...prev, [leagueId]: false }));
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
            {leagues.reduce((sum, l) => sum + l.playerCount, 0)}
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
                    {s.paused && (
                      <Badge variant="outline" className="text-draw border-draw/30 bg-draw/10">
                        <Pause size={10} />
                        Paused
                      </Badge>
                    )}
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
              <CardContent className="space-y-3">
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
                    suffix={
                      captainStats[league.id]
                        ? `(${captainStats[league.id].actual}/${captainStats[league.id].expected} set)`
                        : undefined
                    }
                    suffixClassName={
                      captainStats[league.id] && captainStats[league.id].actual !== captainStats[league.id].expected
                        ? 'text-draw font-mono text-[9px]'
                        : 'text-text-muted/70 font-mono text-[9px]'
                    }
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
                    label="Roster Size"
                    value={s.rosterSize}
                    onChange={v => updateSetting(league.id, 'rosterSize', v)}
                    min={6}
                    max={20}
                    locked={locks.rosterSize}
                    lockReason="Locked once draft has begun"
                  />
                  {/* Roster band — editable in ANY phase (no draft-phase lock). */}
                  <SettingField
                    label="Min Roster"
                    value={s.minRosterSize}
                    onChange={v => updateSetting(league.id, 'minRosterSize', v)}
                    min={1}
                    max={20}
                    locked={false}
                    lockReason=""
                  />
                  <SettingField
                    label="Max Roster"
                    value={s.maxRosterSize}
                    onChange={v => updateSetting(league.id, 'maxRosterSize', v)}
                    min={1}
                    max={30}
                    locked={false}
                    lockReason=""
                  />
                  <SettingField
                    label="Bracket Size"
                    icon={<TrophyIcon size={10} />}
                    value={s.playoffTeamCount}
                    onChange={v => updateSetting(league.id, 'playoffTeamCount', v)}
                    min={2}
                    max={8}
                    step={2}
                    allowed={[2, 4, 6, 8]}
                    locked={locks.playoffTeamCount}
                    lockReason="Locked after season ends"
                  />
                </div>

                {/* Roster-band ordering hint — backend also enforces this. */}
                {(s.minRosterSize > s.rosterSize || s.rosterSize > s.maxRosterSize) && (
                  <div className="flex items-center gap-1.5 text-[11px] text-loss">
                    <AlertTriangle size={11} className="shrink-0" />
                    <span>Roster band must satisfy min ≤ roster size ≤ max ({s.minRosterSize} ≤ {s.rosterSize} ≤ {s.maxRosterSize}).</span>
                  </div>
                )}

                {/* Operational toggles — format + paused + forfeit policy */}
                <div className="grid grid-cols-3 gap-4 pt-2 border-t border-border-subtle">
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Gamepad2 size={10} />
                      Battle Format
                    </label>
                    <Select
                      value={s.format}
                      onValueChange={(v) => updateSetting(league.id, 'format', (v as DraftFormat) ?? 'gen9natdex')}
                    >
                      <SelectTrigger className="h-7 text-xs bg-surface-overlay">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Other formats temporarily hidden — only gen9natdex is supported in S10+. */}
                        {DRAFT_FORMATS.filter(f => f === 'gen9natdex').map(f => (
                          <SelectItem key={f} value={f} className="text-xs">{FORMAT_LABELS[f]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <Pause size={10} />
                      Paused (skip auto jobs)
                    </label>
                    <button
                      type="button"
                      onClick={() => updateSetting(league.id, 'paused', !s.paused)}
                      className={`w-full px-2 py-1 rounded border text-xs transition-colors ${
                        s.paused
                          ? 'border-draw/30 bg-draw/10 text-draw'
                          : 'border-border-default bg-surface-overlay text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {s.paused ? 'Paused' : 'Active'}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-text-muted flex items-center gap-1">
                      <AlertTriangle size={10} />
                      Forfeit Policy
                    </label>
                    <Select
                      value={s.forfeitPolicy}
                      onValueChange={(v) => updateSetting(league.id, 'forfeitPolicy', (v as 'double_forfeit' | 'admin_review') ?? 'double_forfeit')}
                    >
                      <SelectTrigger className="h-7 text-xs bg-surface-overlay">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="double_forfeit" className="text-xs">Double forfeit</SelectItem>
                        <SelectItem value="admin_review" className="text-xs">Admin review</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-text-muted">
                      {league.playerCount} players registered
                      {!league.hasData && ' · No data yet'}
                      {league.season.archived && ' · ARCHIVED'}
                    </div>
                    <Dialog
                      open={!!weekDatesOpen[league.id]}
                      onOpenChange={(open) => {
                        if (open) openWeekDates(league.id);
                        else setWeekDatesOpen(prev => ({ ...prev, [league.id]: false }));
                      }}
                    >
                      <DialogTrigger render={
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                          <Calendar size={12} />
                          Week Dates
                        </Button>
                      } />
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle className="text-sm">
                            Week Dates — {league.name}
                          </DialogTitle>
                        </DialogHeader>
                        <ScheduleDatesStep
                          totalWeeks={league.season.totalWeeks}
                          weekDates={weekDatesEdit[league.id] ?? {}}
                          setWeekDates={(next) => setWeekDatesEdit(prev => ({ ...prev, [league.id]: next }))}
                        />
                        <div className="flex justify-end pt-2">
                          <Button
                            size="sm"
                            onClick={() => saveWeekDates(league.id)}
                            disabled={weekDatesSaving[league.id]}
                            className="bg-neon text-surface-base hover:bg-neon/90"
                          >
                            <Save size={14} />
                            {weekDatesSaving[league.id] ? 'Saving…' : 'Save Dates'}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(league.id)}
                    disabled={saving[league.id] || s.minRosterSize > s.rosterSize || s.rosterSize > s.maxRosterSize}
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
  label, icon, value, onChange, min, max, step, allowed, locked, lockReason, suffix, suffixClassName,
}: {
  label: string;
  icon?: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Whitelist of valid values; out-of-list values are accepted but flagged on save. */
  allowed?: number[];
  locked: boolean;
  lockReason: string;
  /** Small text rendered after the label — e.g. "(2/24 set)" for drift. */
  suffix?: string;
  suffixClassName?: string;
}) {
  const isInvalid = allowed && !allowed.includes(value);
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
        {suffix && (
          <span className={suffixClassName ?? 'text-text-muted/70 font-mono text-[9px]'}>
            {suffix}
          </span>
        )}
      </label>
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        disabled={locked}
        className={isInvalid ? 'border-loss/50' : ''}
      />
      {allowed && (
        <div className="text-[9px] text-text-muted">Allowed: {allowed.join(', ')}</div>
      )}
    </div>
  );
}
