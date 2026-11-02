import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatShortDate } from '../season/schedule-dates-step';
import { fillWeekly, includedLeagues, leagueId, type Draft } from './logic';

const inputCls = 'h-8 rounded-md border border-border bg-surface-base px-2 text-xs text-text-primary outline-none focus:border-pink/60 [color-scheme:dark]';
const Label = ({ children }: { children: string }) => <label className="text-[11px] font-mono uppercase text-text-muted">{children}</label>;

export function StepSchedule({ draft, patch }: { draft: Draft; patch: (p: Partial<Draft>) => void }) {
  const week1 = draft.weekDates['1'] ?? '';
  const setWeek = (w: number, v: string) => {
    const next = { ...draft.weekDates };
    if (v) next[String(w)] = v; else delete next[String(w)];
    patch({ weekDates: next });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="space-y-1"><Label>Weeks</Label>
          <NumberInput value={draft.totalWeeks} min={1} max={30}
            onChange={n => patch({ totalWeeks: n, tradeDeadlineWeek: Math.min(draft.tradeDeadlineWeek, n) })} /></div>
        <div className="space-y-1"><Label>Trade deadline</Label>
          <NumberInput value={draft.tradeDeadlineWeek} min={0} max={draft.totalWeeks} onChange={n => patch({ tradeDeadlineWeek: n })} /></div>
        <div className="space-y-1"><Label>Playoff teams</Label>
          <Select value={String(draft.playoffTeamCount)} onValueChange={v => patch({ playoffTeamCount: Number(v) })}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{[2, 4, 6, 8].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label>Forfeit policy</Label>
          <Select value={draft.forfeitPolicy} onValueChange={v => patch({ forfeitPolicy: v as Draft['forfeitPolicy'] })}>
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="double_forfeit">Double forfeit</SelectItem>
              <SelectItem value="admin_review">Admin review</SelectItem>
            </SelectContent>
          </Select></div>
      </div>

      <div className="rounded-lg border border-border-subtle p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label>Week 1 date</Label>
          <input type="date" value={week1} onChange={e => setWeek(1, e.target.value)} className={inputCls} />
          <Button size="sm" variant="outline" disabled={!week1} onClick={() => patch({ weekDates: fillWeekly(week1, draft.totalWeeks) })}>Fill weekly</Button>
          {Object.keys(draft.weekDates).length > 0 && (
            <button type="button" className="ml-auto text-[11px] text-text-muted hover:text-loss" onClick={() => patch({ weekDates: {} })}>Clear all</button>
          )}
        </div>
        <p className="text-[11px] text-text-muted">Weeks run Tuesday to Monday; each date is the week's end anchor. Fill weekly steps 7 days.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          {Array.from({ length: draft.totalWeeks }, (_, i) => i + 1).map(w => (
            <div key={w} className="flex items-center gap-2 rounded border border-border-subtle px-2 py-1">
              <span className="font-mono text-[11px] text-text-muted w-8">W{w}</span>
              <input type="date" value={draft.weekDates[String(w)] ?? ''} onChange={e => setWeek(w, e.target.value)} className={`${inputCls} h-7 flex-1 min-w-0`} />
              <span className="text-[10px] text-text-muted w-12 text-right">{formatShortDate(draft.weekDates[String(w)] ?? '') || '-'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle p-3 space-y-2">
        <Label>Draft dates</Label>
        {includedLeagues(draft).map(l => (
          <div key={l.key} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
            <span className="text-xs w-36 min-w-0 truncate">{l.name}</span>
            <span className="font-mono text-[10px] text-text-muted hidden sm:inline w-28 truncate">{leagueId(draft.seasonNumber, l.slug)}</span>
            <input type="datetime-local" value={l.draftDate} className={`${inputCls} flex-1 min-w-0 font-mono`}
              onChange={e => patch({ leagues: draft.leagues.map(x => x.key === l.key ? { ...x, draftDate: e.target.value } : x) })} />
          </div>
        ))}
        <p className="text-[10px] text-text-muted">Optional. Leagues without a draft date are not auto-advanced from predraft.</p>
      </div>
    </div>
  );
}
