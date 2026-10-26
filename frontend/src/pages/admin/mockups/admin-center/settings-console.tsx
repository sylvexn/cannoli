import { useMemo, useRef, useState } from 'react';
import { Search, Save, Lock, Layers, SlidersHorizontal, ScrollText, List, CalendarCog, Settings, Zap, Repeat, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { NumberInput } from '@/components/ui/number-input';
import { PageTitle, Pill } from './index';

type Kind = 'text' | 'switch' | 'number' | 'textarea' | 'select';
interface Setting {
  id: string; section: string; label: string; hint: string; kind: Kind;
  value: string | number | boolean; options?: string[]; scope?: 'site' | 'league'; source: string; keywords?: string;
}

const SECTIONS: { id: string; label: string; icon: LucideIcon; from: string }[] = [
  { id: 'general', label: 'General', icon: Settings, from: 'Site Settings' },
  { id: 'draft', label: 'Draft', icon: Zap, from: 'Site Settings + League config' },
  { id: 'trades', label: 'Trades & FA', icon: Repeat, from: 'League config' },
  { id: 'season', label: 'Season & Schedule', icon: CalendarCog, from: 'Season / Leagues' },
  { id: 'rules', label: 'Rules text', icon: ScrollText, from: 'Rules tab' },
  { id: 'templates', label: 'Templates', icon: Layers, from: 'Templates tab' },
  { id: 'tiers', label: 'Tier list', icon: List, from: 'Tier List tab' },
  { id: 'rulesets', label: 'Rulesets', icon: Lock, from: 'designed separately' },
];

const S = (section: string, id: string, label: string, hint: string, kind: Kind, value: Setting['value'], extra: Partial<Setting> = {}): Setting =>
  ({ id, section, label, hint, kind, value, source: extra.source ?? 'site_settings', ...extra });

const INITIAL: Setting[] = [
  S('general', 'pw', 'Default user password', 'New accounts and resets use this. Users change it on first login.', 'text', 'password'),
  S('general', 'ann', 'Show announcement banner', 'Pinned announcements render above the app shell.', 'switch', true, { keywords: 'banner' }),
  S('general', 'maint', 'Maintenance mode', 'Non-staff see the under-construction page.', 'switch', false),
  S('draft', 'timer', 'Enable pick timer', 'When off, players have unlimited time per pick.', 'switch', true),
  S('draft', 'timerSecs', 'Pick timer (seconds)', 'Per-pick clock. Pauses on expiry.', 'number', 90, { scope: 'league', source: 'leagues.draft_timer' }),
  S('draft', 'demo', 'Show demo mode', 'When hidden only Season and Live modes appear on the draft board.', 'switch', true),
  S('draft', 'captains', 'Captains per team', 'Tera captain count. Default 2.', 'number', 2, { scope: 'league', source: 'leagues.captain_count', keywords: 'tera' }),
  S('draft', 'budget', 'Draft budget', 'Total cost points per team.', 'number', 120, { scope: 'league', source: 'leagues.budget' }),
  S('trades', 'tradeDeadline', 'Trade deadline', 'Last day trades may be submitted. Weeks run Tue to Mon.', 'text', 'Mon Nov 16, 23:59', { scope: 'league', source: 'leagues.trade_deadline', keywords: 'deadline' }),
  S('trades', 'tradeApproval', 'Trades need staff approval', 'Off = auto-accept once both coaches agree.', 'switch', true, { scope: 'league', source: 'leagues.trade_approval' }),
  S('trades', 'faWeekly', 'FA moves per week', 'Max free-agent claims per team per week.', 'number', 2, { scope: 'league', source: 'leagues.fa_limit', keywords: 'free agent' }),
  S('trades', 'faCutoff', 'FA claim cutoff', 'Claims after this are queued for next week.', 'text', 'Sun 20:00', { scope: 'league', source: 'leagues.fa_cutoff' }),
  S('trades', 'teraWho', 'Tera changes need approval', 'Route tera-type changes through the Tera lane on the dashboard.', 'switch', true, { scope: 'league', source: 'leagues.tera_approval', keywords: 'tera approval' }),
  S('season', 'weeks', 'Regular season weeks', 'Number of regular-season weeks before playoffs.', 'number', 8, { scope: 'league', source: 'leagues.weeks' }),
  S('season', 'weekStart', 'Week 1 start date', 'All other week dates derive from this.', 'text', 'Tue Oct 6', { scope: 'league', source: 'leagues.week_dates', keywords: 'schedule date' }),
  S('season', 'playoffTeams', 'Playoff teams', 'Seeds that qualify.', 'number', 6, { scope: 'league', source: 'leagues.playoff_teams' }),
  S('season', 'reveal', 'Reveal results automatically', 'Publish a week the moment every match is reported.', 'switch', false, { scope: 'league', source: 'leagues.auto_reveal', keywords: 'publish' }),
  S('season', 'format', 'Cost format', 'natdex (Emerald) or natdexplus (Ruby/Sapphire).', 'select', 'natdexplus', { options: ['natdex', 'natdexplus'], scope: 'league', source: 'leagues.format' }),
  S('rules', 'rulesIntro', 'Rules: overview', 'First section of the rules page.', 'textarea', 'Teams draft within a point budget. Max 1 Mega per team, no duplicate National Dex numbers.', { scope: 'league', source: 'league_rules' }),
  S('rules', 'rulesClauses', 'Rules: battle clauses', 'One clause per line. Shown on the Rules page and in the PS room.', 'textarea', 'Species Clause\nSleep Clause\nEvasion Moves Clause\nOHKO Clause', { scope: 'league', source: 'league_rules', keywords: 'clause' }),
  S('rules', 'rulesBans', 'Rules: Pokemon bans', 'Format-level bans, with reason.', 'textarea', 'Zacian-Crowned: restricted\nCalyrex-Shadow: restricted', { scope: 'league', source: 'league_rules', keywords: 'ban' }),
];

const TEMPLATES = [
  { name: 'Weekly deadline reminder', channel: 'Discord', used: 'auto, Monday 18:00' },
  { name: 'Trade accepted', channel: 'In-app', used: 'on trade approval' },
  { name: 'Ticket resolved', channel: 'In-app + Discord DM', used: 'on ticket status = Fixed (new)' },
  { name: 'Draft starting soon', channel: 'Discord', used: 'T-30m' },
];
const TIERS = [['1', 14, 1], ['2', 22, 2], ['3', 31, 4], ['4', 38, 5], ['5', 40, 6], ['6', 33, 8], ['7', 25, 9], ['8', 18, 10], ['9', 12, 12]] as const;

function FieldRow({ s, v, set, hit }: { s: Setting; v: Setting['value']; set: (v: Setting['value']) => void; hit: boolean }) {
  return (
    <div id={`set-${s.id}`} className={cn('flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-2.5 rounded-md border transition-colors',
      hit ? 'border-neon/60 bg-neon/10 ring-1 ring-neon/30' : 'border-transparent hover:bg-surface-overlay/30')}>
      <div className="min-w-0 sm:flex-1">
        <div className="text-sm text-text-primary flex items-center gap-2 flex-wrap">
          {s.label}
          {s.scope === 'league' && <Pill className="border-pink/40 text-pink">per league</Pill>}
        </div>
        <div className="text-[11px] text-text-muted">{s.hint} <span className="font-mono opacity-60">{s.source}</span></div>
      </div>
      <div className="sm:w-60 shrink-0">
        {s.kind === 'switch' && <Switch checked={v as boolean} onCheckedChange={set} />}
        {s.kind === 'text' && <Input value={v as string} onChange={e => set(e.target.value)} className="font-mono" />}
        {s.kind === 'number' && <NumberInput value={v as number} onChange={set} min={0} />}
        {s.kind === 'textarea' && <Textarea value={v as string} onChange={e => set(e.target.value)} rows={3} className="font-mono text-xs" />}
        {s.kind === 'select' && (
          <select value={v as string} onChange={e => set(e.target.value)} className="h-8 w-full rounded-md border border-border-default bg-surface-base px-2 text-sm">
            {s.options!.map(o => <option key={o}>{o}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function SettingsConsole() {
  const [vals, setVals] = useState<Record<string, Setting['value']>>(() => Object.fromEntries(INITIAL.map(s => [s.id, s.value])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [league, setLeague] = useState('Ruby');
  const [active, setActive] = useState('general');
  const topRef = useRef<HTMLDivElement>(null);

  const qn = query.trim().toLowerCase();
  const matches = (s: Setting) => !!qn && `${s.label} ${s.hint} ${s.section} ${s.keywords ?? ''} ${s.source}`.toLowerCase().includes(qn);
  const hitIds = useMemo(() => new Set(INITIAL.filter(matches).map(s => s.id)), [qn]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectionMatch = (id: string, label: string) => !qn || label.toLowerCase().includes(qn) || INITIAL.some(s => s.section === id && hitIds.has(s.id));
  const visibleSections = SECTIONS.filter(sec => sectionMatch(sec.id, sec.label));
  const shown = qn ? visibleSections : SECTIONS.filter(sec => sec.id === active);

  const jump = (id: string) => { setActive(id); setQuery(''); topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const set = (id: string, v: Setting['value']) => { setVals(p => ({ ...p, [id]: v })); setDirty(d => new Set(d).add(id)); };

  return (
    <div ref={topRef}>
      <PageTitle a="Settings" b="Console" accent="text-pink" sub="Site, season, rules, templates and tiers in one searchable place."
        right={(
          <select value={league} onChange={e => setLeague(e.target.value)} className="h-8 rounded-md border border-border-default bg-surface-base px-2 text-sm" aria-label="League scope">
            {['Ruby', 'Sapphire', 'Emerald'].map(l => <option key={l}>{l}</option>)}
          </select>
        )} />

      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder='Search settings, e.g. "trade deadline", "tera", "clause"' className="pl-8 h-9" />
        {qn && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">{hitIds.size} match{hitIds.size === 1 ? '' : 'es'}</span>}
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <nav className="md:w-[170px] shrink-0 flex md:flex-col gap-0.5 overflow-x-auto md:sticky md:top-4 md:self-start">
          {SECTIONS.map(sec => {
            const Icon = sec.icon;
            const dim = qn && !sectionMatch(sec.id, sec.label);
            const n = INITIAL.filter(s => s.section === sec.id && hitIds.has(s.id)).length;
            return (
              <button key={sec.id} onClick={() => jump(sec.id)} title={`Absorbs: ${sec.from}`}
                className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left whitespace-nowrap min-h-7',
                  active === sec.id && !qn ? 'bg-surface-overlay text-text-primary font-medium' : 'text-text-muted hover:bg-surface-overlay/40',
                  dim && 'opacity-30')}>
                <Icon size={14} className="shrink-0" /><span className="truncate min-w-0">{sec.label}</span>
                {n > 0 && <span className="ml-auto rounded-full bg-neon/20 text-neon text-[10px] font-mono px-1.5">{n}</span>}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 space-y-6">
          {qn && visibleSections.length === 0 && <div className="text-sm text-text-muted py-8 text-center">No settings match "{query}".</div>}
          {shown.map(sec => {
            const Icon = sec.icon;
            return (
              <section key={sec.id}>
                <h3 className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-[0.12em] text-text-secondary border-b border-border-subtle pb-1.5 mb-2">
                  <Icon size={13} />{sec.label}
                  {INITIAL.some(s => s.section === sec.id && s.scope === 'league') && <span className="ml-auto text-[10px] normal-case tracking-normal font-sans text-text-muted">scope: {league}</span>}
                </h3>
                {INITIAL.filter(s => s.section === sec.id).map(s => (
                  <FieldRow key={s.id} s={s} v={vals[s.id]} set={v => set(s.id, v)} hit={hitIds.has(s.id)} />
                ))}
                {sec.id === 'templates' && (
                  <div className="overflow-x-auto"><table className="w-full text-[12px]">
                    <thead><tr className="text-left text-text-muted"><th className="py-1 px-3 font-normal">Template</th><th className="font-normal">Channel</th><th className="font-normal">Trigger</th><th /></tr></thead>
                    <tbody>{TEMPLATES.map(t => (
                      <tr key={t.name} className={cn('border-t border-border-subtle', qn && t.name.toLowerCase().includes(qn) && 'bg-neon/10')}>
                        <td className="py-1.5 px-3 text-text-primary">{t.name}</td><td>{t.channel}</td><td className="text-text-muted">{t.used}</td>
                        <td className="text-right pr-2"><Button variant="ghost" size="sm" className="h-6 text-[11px]">Edit</Button></td>
                      </tr>))}</tbody></table></div>
                )}
                {sec.id === 'tiers' && (
                  <div className="overflow-x-auto"><table className="w-full text-[12px] font-mono">
                    <thead><tr className="text-left text-text-muted"><th className="py-1 px-3 font-normal">Tier</th><th className="font-normal">Pokemon</th><th className="font-normal">Cost</th><th className="font-normal">Captain cost</th></tr></thead>
                    <tbody>{TIERS.map(([t, n, c]) => (
                      <tr key={t} className="border-t border-border-subtle"><td className="py-1.5 px-3">T{t}</td><td>{n}</td><td>{c}</td><td className="text-text-muted">{t === '9' ? 12 : c}</td></tr>))}</tbody></table>
                    <p className="text-[11px] text-text-muted px-3 pt-2 font-sans">Compact summary. "Edit tier list" opens the existing grid editor inline here (reused, not rebuilt).</p>
                  </div>
                )}
                {sec.id === 'rulesets' && (
                  <div className="m-1 rounded-lg border-2 border-dashed border-border-default bg-surface-overlay/20 p-8 text-center">
                    <Lock size={20} className="mx-auto text-text-muted mb-2" />
                    <div className="text-sm font-mono uppercase tracking-wide">Rulesets placeholder</div>
                    <p className="text-[12px] text-text-muted max-w-sm mx-auto mt-1">Designed separately. This slot is reserved so the console's section nav and search index already have a home for it.</p>
                  </div>
                )}
              </section>
            );
          })}
          <div className="sticky bottom-2 flex items-center gap-3 rounded-lg border border-border-default bg-surface-raised/95 backdrop-blur px-3 py-2">
            <SlidersHorizontal size={14} className="text-text-muted" />
            <span className="text-[12px] text-text-muted">{dirty.size ? `${dirty.size} unsaved change${dirty.size > 1 ? 's' : ''}` : 'No changes'}</span>
            <Button size="sm" disabled={!dirty.size} className="ml-auto bg-neon text-surface-base hover:bg-neon/90 gap-1.5 h-8"
              onClick={() => { toast.success(`Mock: saved ${dirty.size} setting(s)`); setDirty(new Set()); }}><Save size={13} />Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
