/**
 * Settings Console (/admin/console): one searchable home for Site Settings, Rules, Templates and Tier List.
 *
 * Save model: scalar site settings share ONE sticky Save bar with a dirty count. Bulk editors (rules text,
 * templates CRUD, tier list) keep their own save flows inside their section: they are list/grid editors with
 * per-league scope, confirm dialogs and server-side locks, so folding them into one transaction would change
 * their semantics. Active section lives in the URL hash so old tab URLs can redirect into it.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Save, Search, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import { cn } from '@/lib/utils';
import { AdminRules } from '../rules';
import { AdminTemplates } from '../admin-templates';
import { AdminTierList } from '../admin-tier-list';
import { RulesetsAdmin } from '../rulesets';
import { SECTIONS, SETTINGS, matchSettings, type SectionId } from './registry';
import { DeadlineFields, DraftFields, GeneralFields, useSiteSettings } from './site-form';

const isSection = (h: string): h is SectionId => SECTIONS.some(s => s.id === h);

export function SettingsConsole() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const site = useSiteSettings();
  const [query, setQuery] = useState('');

  const hashId = hash.replace('#', '');
  const active: SectionId = isSection(hashId) ? hashId : 'general';
  const hits = useMemo(() => matchSettings(query), [query]);
  const hitIds = useMemo(() => new Set(hits.map(h => h.id)), [hits]);
  const hitSections = useMemo(() => new Set(hits.map(h => h.section)), [hits]);

  const go = (section: SectionId, fieldId?: string) => {
    navigate({ hash: section }, { replace: true });
    if (fieldId) requestAnimationFrame(() => requestAnimationFrame(() =>
      document.getElementById(`set-${fieldId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
  };

  // Typing jumps to the best match so the field is highlighted and scrolled into view.
  const first = hits[0];
  useEffect(() => {
    if (first) go(first.section, first.field ? first.id : undefined);
  }, [first?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const section = SECTIONS.find(s => s.id === active)!;
  const dirty = site.dirtyKeys.length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-mono font-bold uppercase tracking-tight">
          <span className="text-pink">Settings</span>{' '}<span className="text-text-primary">Console</span>
        </h1>
        <p className="text-xs text-text-muted">Site, rules, templates and tiers in one searchable place.</p>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <Input value={query} onChange={e => setQuery(e.target.value)} className="pl-8 h-9"
          placeholder='Search settings, e.g. "trade deadline", "pick timer", "clause"' aria-label="Search settings" />
        {query.trim() && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">{hits.length} match{hits.length === 1 ? '' : 'es'}</span>}
      </div>
      {hits.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {hits.map(h => (
            <button key={h.id} onClick={() => go(h.section, h.field ? h.id : undefined)}
              className="rounded-full border border-neon/40 bg-neon/10 px-2.5 min-h-6 text-[11px] text-text-primary hover:bg-neon/20">
              {h.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4">
        <nav className="md:w-[170px] shrink-0 flex md:flex-col gap-0.5 overflow-x-auto md:sticky md:top-4 md:self-start" aria-label="Settings sections">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            const dim = hits.length > 0 && !hitSections.has(s.id);
            return (
              <button key={s.id} onClick={() => go(s.id)} title={`Absorbs: ${s.from}`}
                className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] text-left whitespace-nowrap min-h-7',
                  active === s.id ? 'bg-surface-overlay text-text-primary font-medium' : 'text-text-muted hover:bg-surface-overlay/40',
                  dim && 'opacity-30')}>
                <Icon size={14} className="shrink-0" /><span className="truncate min-w-0">{s.label}</span>
                {hitSections.has(s.id) && <span className="ml-auto size-1.5 rounded-full bg-neon shrink-0" />}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0">
          <h2 className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-[0.12em] text-text-secondary border-b border-border-subtle pb-1.5 mb-3">
            <section.icon size={13} />{section.label}
          </h2>
          {(active === 'general' || active === 'draft' || active === 'deadlines') && site.loading && <LoadingSprite label="Loading settings..." />}
          {active === 'general' && !site.loading && <GeneralFields site={site} hits={hitIds} />}
          {active === 'draft' && !site.loading && <DraftFields site={site} hits={hitIds} />}
          {active === 'deadlines' && !site.loading && <DeadlineFields site={site} hits={hitIds} />}
          {active === 'league' && <LeagueLinks />}
          {active === 'rules' && <div id="set-rulesAll" className="scroll-mt-24"><AdminRules /></div>}
          {active === 'templates' && <div id="set-templates" className="scroll-mt-24"><AdminTemplates /></div>}
          {active === 'tiers' && <div id="set-tiers" className="scroll-mt-24"><AdminTierList /></div>}
          {active === 'rulesets' && <div id="rulesets" className="scroll-mt-24"><RulesetsAdmin /></div>}
        </div>
      </div>

      {dirty > 0 && (
        <div className="sticky bottom-3 z-20 flex items-center gap-3 rounded-lg border border-pink/40 bg-surface-raised/95 backdrop-blur px-3 py-2 shadow-lg">
          <span className="text-sm text-text-primary min-w-0 truncate">
            <span className="font-mono text-pink">{dirty}</span> unsaved change{dirty === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={site.discard} disabled={site.saving} className="gap-1.5"><Undo2 size={13} />Discard</Button>
            <Button size="sm" onClick={site.save} disabled={site.saving} className="bg-neon text-surface-base hover:bg-neon/90 gap-1.5">
              {site.saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** League/season config is edited per league in Seasons & Leagues; list the fields here so search can find them. */
function LeagueLinks() {
  const rows = SETTINGS.filter(s => s.section === 'league');
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">These are per-league and phase-locked, so they stay where the season controls live.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/admin/leagues" className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 min-h-8 text-sm hover:bg-surface-overlay/40">
          League settings <ArrowRight size={13} />
        </Link>
        <Link to="/admin/season" className="inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 min-h-8 text-sm hover:bg-surface-overlay/40">
          Season controls <ArrowRight size={13} />
        </Link>
      </div>
      <ul className="text-[11px] text-text-muted flex flex-wrap gap-x-3 gap-y-1">
        {rows.map(r => <li key={r.id}>{r.label}</li>)}
      </ul>
    </div>
  );
}
