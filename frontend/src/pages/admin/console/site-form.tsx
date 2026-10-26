import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { NumberInput } from '@/components/ui/number-input';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

export interface SiteSettings {
  defaultUserPassword: string;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
  faDeadlineWeek: number;
  faPickupsPerSeason: number;
  /** Per-league trade deadline week, keyed by league id (saved via the league, not site settings). */
  tradeDeadlines: Record<string, number>;
}
type Scalar = Exclude<keyof SiteSettings, 'tradeDeadlines'>;

const DEFAULTS: SiteSettings = {
  defaultUserPassword: 'password', draftTimerEnabled: true, draftDemoVisible: true,
  faDeadlineWeek: 7, faPickupsPerSeason: 6, tradeDeadlines: {},
};

/** Loads site settings (+ active leagues' trade deadlines) and tracks keys that differ from the saved baseline. */
export function useSiteSettings() {
  const { leagues, refreshLeagues } = useAppData();
  const activeLeagues = useMemo(() => leagues.filter(l => !l.season?.archived), [leagues]);
  const [saved, setSaved] = useState<SiteSettings>(DEFAULTS);
  const [draft, setDraft] = useState<SiteSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSiteSettings()
      .then(s => {
        const v = {
          defaultUserPassword: s.defaultUserPassword ?? DEFAULTS.defaultUserPassword,
          draftTimerEnabled: s.draftTimerEnabled ?? true,
          draftDemoVisible: s.draftDemoVisible ?? true,
          faDeadlineWeek: s.faDeadlineWeek ?? DEFAULTS.faDeadlineWeek,
          faPickupsPerSeason: s.faPickupsPerSeason ?? DEFAULTS.faPickupsPerSeason,
        };
        setSaved(p => ({ ...p, ...v })); setDraft(p => ({ ...p, ...v }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Trade deadlines come from the league list (refreshes after a save).
  useEffect(() => {
    const td = Object.fromEntries(activeLeagues.map(l => [l.id, l.season?.tradeDeadlineWeek ?? 0]));
    setSaved(p => ({ ...p, tradeDeadlines: td }));
    setDraft(p => ({ ...p, tradeDeadlines: { ...td, ...p.tradeDeadlines } }));
  }, [activeLeagues]);

  const changedLeagues = useMemo(
    () => Object.keys(draft.tradeDeadlines).filter(id => draft.tradeDeadlines[id] !== saved.tradeDeadlines[id]),
    [draft, saved],
  );
  const dirtyKeys = useMemo(
    () => [
      ...(Object.keys(draft) as (keyof SiteSettings)[]).filter(k => k !== 'tradeDeadlines' && draft[k] !== saved[k]),
      ...changedLeagues.map(id => `tradeDeadline:${id}`),
    ],
    [draft, saved, changedLeagues],
  );
  const set = useCallback(<K extends Scalar>(k: K, v: SiteSettings[K]) => setDraft(p => ({ ...p, [k]: v })), []);
  const setTradeDeadline = useCallback((leagueId: string, week: number) =>
    setDraft(p => ({ ...p, tradeDeadlines: { ...p.tradeDeadlines, [leagueId]: week } })), []);
  const discard = useCallback(() => setDraft(saved), [saved]);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const { tradeDeadlines, ...scalars } = draft;
      await api.saveSiteSettings(scalars as unknown as Record<string, unknown>);
      for (const id of changedLeagues) await api.updateLeague(id, { tradeDeadlineWeek: tradeDeadlines[id] });
      if (changedLeagues.length) refreshLeagues();
      setSaved(draft);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [draft, changedLeagues, refreshLeagues]);

  return { draft, loading, saving, dirtyKeys, set, setTradeDeadline, discard, save, activeLeagues };
}

type Site = ReturnType<typeof useSiteSettings>;

function Row({ id, label, hint, hit, dirty, children }: { id: string; label: string; hint: string; hit: boolean; dirty: boolean; children: React.ReactNode }) {
  return (
    <div id={`set-${id}`} className={cn('flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-2.5 rounded-md border transition-colors scroll-mt-24',
      hit ? 'border-neon/60 bg-neon/10 ring-1 ring-neon/30' : 'border-transparent hover:bg-surface-overlay/30')}>
      <div className="min-w-0 sm:flex-1">
        <div className="text-sm text-text-primary flex items-center gap-2">
          {label}
          {dirty && <span className="size-1.5 rounded-full bg-pink shrink-0" title="Unsaved change" />}
        </div>
        <div className="text-[11px] text-text-muted">{hint}</div>
      </div>
      <div className="sm:w-60 shrink-0">{children}</div>
    </div>
  );
}

export function GeneralFields({ site, hits }: { site: Site; hits: Set<string> }) {
  const { draft, dirtyKeys, set } = site;
  return (
    <Row id="defaultUserPassword" label="Default user password" hit={hits.has('defaultUserPassword')} dirty={dirtyKeys.includes('defaultUserPassword')}
      hint="New accounts and password resets use this. Users must change it on first login.">
      <Input value={draft.defaultUserPassword} onChange={e => set('defaultUserPassword', e.target.value)} placeholder="password" className="font-mono" />
    </Row>
  );
}

export function DraftFields({ site, hits }: { site: Site; hits: Set<string> }) {
  const { draft, dirtyKeys, set } = site;
  return (
    <>
      <Row id="draftTimerEnabled" label="Enable pick timer" hit={hits.has('draftTimerEnabled')} dirty={dirtyKeys.includes('draftTimerEnabled')}
        hint="When disabled, players have unlimited time per pick.">
        <Switch checked={draft.draftTimerEnabled} onCheckedChange={v => set('draftTimerEnabled', v)} />
      </Row>
      <Row id="draftDemoVisible" label="Show demo mode" hit={hits.has('draftDemoVisible')} dirty={dirtyKeys.includes('draftDemoVisible')}
        hint="When hidden, only Season and Live modes are available on the draft board.">
        <Switch checked={draft.draftDemoVisible} onCheckedChange={v => set('draftDemoVisible', v)} />
      </Row>
    </>
  );
}

export function DeadlineFields({ site, hits }: { site: Site; hits: Set<string> }) {
  const { draft, dirtyKeys, set, setTradeDeadline, activeLeagues } = site;
  return (
    <>
      <Row id="faDeadlineWeek" label="Free agent deadline (week)" hit={hits.has('faDeadlineWeek')} dirty={dirtyKeys.includes('faDeadlineWeek')}
        hint="Last week coaches can request pickups, for every league. Approvals still land the following week.">
        <NumberInput value={draft.faDeadlineWeek} onChange={v => set('faDeadlineWeek', v)} min={0} max={30} />
      </Row>
      <Row id="faPickupsPerSeason" label="Free agent pickups per season" hit={hits.has('faPickupsPerSeason')} dirty={dirtyKeys.includes('faPickupsPerSeason')}
        hint="How many free agents each team may pick up in a season.">
        <NumberInput value={draft.faPickupsPerSeason} onChange={v => set('faPickupsPerSeason', v)} min={0} max={30} />
      </Row>
      <div id="set-tradeDeadline" className="scroll-mt-24 pt-2">
        <div className={cn('px-3 pb-1 text-[11px] font-mono uppercase tracking-wider', hits.has('tradeDeadline') ? 'text-neon' : 'text-text-muted')}>
          Trade deadline (week) — per league, 0 = no deadline
        </div>
        {activeLeagues.length === 0 && <p className="px-3 text-xs text-text-muted">No active leagues.</p>}
        {activeLeagues.map(l => (
          <Row key={l.id} id={`tradeDeadline-${l.id}`} label={l.name} hit={false} dirty={dirtyKeys.includes(`tradeDeadline:${l.id}`)}
            hint={`Season ${l.season?.seasonNumber ?? '?'} · week ${l.season?.currentWeek ?? 0} of ${l.season?.totalWeeks ?? '?'}`}>
            <NumberInput value={draft.tradeDeadlines[l.id] ?? 0} onChange={v => setTradeDeadline(l.id, v)} min={0} max={l.season?.totalWeeks ?? 30} />
          </Row>
        ))}
      </div>
    </>
  );
}
