import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ScrollText,
  Swords,
  Star,
  ShieldOff,
  Info,
  ListOrdered,
  BookOpen,
  Ban,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingSprite } from '@/components/loading-sprite';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { LeagueRulesResponse } from '@/lib/rules-types';
import { cn } from '@/lib/utils';

/** A document section that appears in both the TOC and the body. */
interface SectionDef {
  id: string;
  label: string;
  icon: typeof ScrollText;
  /** Whether this section has content worth rendering / linking. */
  present: boolean;
}

export function RulesPage() {
  const { leagues, loading: leaguesLoading } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();

  // Resolve the selected league from ?league=, falling back to the first.
  const paramLeagueId = searchParams.get('league');
  const selectedLeague = useMemo(() => {
    if (leagues.length === 0) return null;
    return leagues.find(l => l.id === paramLeagueId) ?? leagues[0];
  }, [leagues, paramLeagueId]);

  const [data, setData] = useState<LeagueRulesResponse | null>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(false);

  // Normalize an invalid/missing ?league= to the resolved default.
  useEffect(() => {
    if (!selectedLeague) return;
    if (paramLeagueId !== selectedLeague.id) {
      setSearchParams({ league: selectedLeague.id }, { replace: true });
    }
  }, [selectedLeague, paramLeagueId, setSearchParams]);

  useEffect(() => {
    if (!selectedLeague) return;
    let cancelled = false;
    setFetching(true);
    setError(false);
    api
      .getLeagueRules(selectedLeague.id)
      .then(res => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLeague]);

  const selectLeague = (id: string) => setSearchParams({ league: id });

  // Initial load: leagues still resolving.
  if (leaguesLoading && leagues.length === 0) {
    return (
      <div className="space-y-3">
        <Header />
        <LoadingSprite label="Loading leagues" />
      </div>
    );
  }

  if (leagues.length === 0) {
    return (
      <div className="space-y-3">
        <Header />
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="py-10 text-center text-sm text-text-muted">
            No leagues are available yet. Rules appear here once a season is set up.
          </CardContent>
        </Card>
      </div>
    );
  }

  const content = data?.content ?? null;

  const sections: SectionDef[] = content
    ? [
        { id: 'notes', label: 'Additional Notes', icon: Info, present: content.notes.trim().length > 0 },
        { id: 'draft', label: 'Draft Rules', icon: BookOpen, present: content.draftRules.length > 0 },
        { id: 'battle', label: 'Battle Rules', icon: Swords, present: content.battleRules.length > 0 },
        { id: 'clauses', label: 'Clauses', icon: ListOrdered, present: content.clauses.length > 0 },
        { id: 'pokemon-bans', label: 'Pokémon-Specific Bans', icon: Ban, present: content.pokemonBans.length > 0 },
        {
          id: 'bans',
          label: 'Banned Abilities, Items & Moves',
          icon: ShieldOff,
          present:
            content.bannedAbilities.length > 0 ||
            content.bannedItems.length > 0 ||
            content.bannedMoves.length > 0,
        },
        { id: 'tera-bans', label: 'Tera Captain Bans', icon: Star, present: content.teraCaptainBans.length > 0 },
      ].filter(s => s.present)
    : [];

  return (
    <div className="space-y-3">
      <Header />

      {/* League switcher */}
      <LeagueSwitcher leagues={leagues} selectedId={selectedLeague?.id ?? null} onSelect={selectLeague} />

      {/* Body */}
      {fetching && !data ? (
        <LoadingSprite label="Loading rules" />
      ) : error || !content ? (
        <Card className="bg-surface-raised border-border-default">
          <CardContent className="py-10 text-center text-sm text-loss">
            <ShieldAlert size={18} className="mx-auto mb-2 opacity-70" />
            Could not load rules for this league. Please try again.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <Toc sections={sections} accent={selectedLeague?.color} />

          <div
            className={cn(
              'min-w-0 flex-1 max-w-3xl space-y-5',
              fetching && 'opacity-60 transition-opacity',
            )}
          >
            {sections.map(s => (
              <Section key={s.id} id={s.id} label={s.label} icon={s.icon}>
                {s.id === 'notes' && (
                  <div className="rounded-md bg-surface-raised border border-border-default px-4 py-3 flex gap-3">
                    <ScrollText size={15} className="text-neon shrink-0 mt-0.5" />
                    <p className="text-xs text-text-secondary whitespace-pre-line leading-relaxed">
                      {content.notes}
                    </p>
                  </div>
                )}

                {s.id === 'draft' && <RuleList rules={content.draftRules} />}
                {s.id === 'battle' && <RuleList rules={content.battleRules} />}

                {s.id === 'clauses' && (
                  <dl className="space-y-1.5 text-[12px] leading-snug">
                    {content.clauses.map(c => (
                      <div key={c.name}>
                        <dt className="inline font-semibold text-text-primary">{c.name}:</dt>{' '}
                        <dd className="inline text-text-secondary">{c.description}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {s.id === 'pokemon-bans' && (
                  <ul className="space-y-1 text-xs">
                    {content.pokemonBans.map(b => (
                      <li key={`${b.pokemon}-${b.move}`} className="text-text-secondary leading-snug">
                        <span className="font-medium text-text-primary">{b.move}</span> is banned on{' '}
                        <span className="text-pink">{b.pokemon}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {s.id === 'bans' && (
                  <div className="space-y-3">
                    {content.bannedAbilities.length > 0 && (
                      <ChipGroup title="Abilities" items={content.bannedAbilities} />
                    )}
                    {content.bannedItems.length > 0 && (
                      <ChipGroup title="Items" items={content.bannedItems} />
                    )}
                    {content.bannedMoves.length > 0 && (
                      <ChipGroup title="Moves" items={content.bannedMoves} />
                    )}
                  </div>
                )}

                {s.id === 'tera-bans' && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                      draftable, but not as captain
                    </p>
                    <Chips items={content.teraCaptainBans} />
                  </div>
                )}
              </Section>
            ))}

            {sections.length === 0 && (
              <p className="text-sm text-text-muted py-8 text-center">
                No rules have been published for this league yet.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
        <span className="text-pink">League</span>{' '}
        <span className="text-text-primary">Rules</span>
      </h1>
      <p className="text-xs text-text-muted">
        Cannoli draft and battle rules — read before drafting. Rules can differ per league.
      </p>
    </div>
  );
}

function LeagueSwitcher({
  leagues,
  selectedId,
  onSelect,
}: {
  leagues: { id: string; name: string; color: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-px rounded border border-border-subtle overflow-hidden w-fit">
      {leagues.map(l => {
        const active = l.id === selectedId;
        return (
          <button
            key={l.id}
            onClick={() => onSelect(l.id)}
            className={cn(
              'px-3 py-1 text-xs font-medium transition-colors border-b-2',
              active
                ? 'bg-surface-overlay text-text-primary'
                : 'border-transparent text-text-muted hover:bg-surface-overlay/40 hover:text-text-secondary',
            )}
            style={active ? { borderBottomColor: l.color } : undefined}
          >
            <span
              className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: l.color, opacity: active ? 1 : 0.5 }}
            />
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

function Toc({ sections, accent }: { sections: SectionDef[]; accent?: string }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);
  const idsKey = sections.map(s => s.id).join('|');

  // Scroll-spy: highlight the section nearest the top of the viewport.
  useEffect(() => {
    const ids = idsKey.split('|').filter(Boolean);
    if (ids.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [idsKey]);

  const go = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <nav
      className={cn(
        'shrink-0 w-full lg:w-56 lg:sticky lg:top-4 self-start',
        'flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible',
        'pb-1 lg:pb-0 border-b lg:border-b-0 border-border-subtle',
      )}
    >
      <span className="hidden lg:block text-[10px] font-mono uppercase tracking-wider text-text-muted px-2 pb-1">
        Contents
      </span>
      {sections.map(s => {
        const active = s.id === activeId;
        const Icon = s.icon;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            onClick={e => go(e, s.id)}
            className={cn(
              'flex items-center gap-2 rounded px-2 py-1 text-xs whitespace-nowrap transition-colors border-l-2',
              active
                ? 'bg-surface-overlay/60 text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-surface-overlay/50',
            )}
            style={active ? { borderLeftColor: accent ?? 'var(--color-neon)' } : undefined}
          >
            <Icon size={13} className="shrink-0 opacity-80" />
            <span className="truncate">{s.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

function Section({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  icon: typeof ScrollText;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="flex items-center gap-2 text-sm font-mono uppercase tracking-wide text-text-primary mb-2 pb-1 border-b border-border-subtle">
        <Icon size={15} className="text-neon" />
        {label}
      </h2>
      {children}
    </section>
  );
}

function RuleList({ rules }: { rules: string[] }) {
  return (
    <ol className="space-y-1.5 text-xs text-text-secondary list-decimal pl-5 leading-relaxed marker:text-text-muted">
      {rules.map((rule, i) => (
        <li key={i}>{rule}</li>
      ))}
    </ol>
  );
}

function ChipGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1">{title}</h4>
      <Chips items={items} />
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(name => (
        <span
          key={name}
          className="inline-flex items-center rounded-md bg-surface-overlay/60 border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary"
        >
          {name}
        </span>
      ))}
    </div>
  );
}
