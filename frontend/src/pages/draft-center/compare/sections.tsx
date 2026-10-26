import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Minus, Sparkles, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TYPE_COLORS } from '@/lib/constants';
import { pokemonRoute } from '@/lib/pokemon-route';
import { DEFAULT_MOVE_CATEGORIES, type MoveCategory } from '@/data/move-categories';
import { holesOf, mergedSpeedLadder, outspeeds, roleChecklist, sharedUnique, typeScore, typeTotals, type Side } from '@/lib/draft-center/compare';
import { warnCount } from '@/lib/draft-center/rules';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcTeam, DcValidation } from '@/lib/draft-center/types';
import { loadCategories } from '../analysis/roles-panel';
import { SIDE_STYLE, Section, SideTag } from './common';

export interface Cmp { team: DcTeam; ruleset: Ruleset; v: DcValidation }
type Props = { a: Cmp; b: Cmp };

const empty = <span className="text-text-muted">-</span>;

function MonLink({ name, className }: { name: string; className?: string }) {
  return (
    <Link to={pokemonRoute(name)} className={cn('inline-flex items-center gap-1 min-w-0 text-xs font-mono hover:text-neon hover:underline', className)}>
      <PokemonSprite name={name} size="xs" className="shrink-0" /><span className="truncate">{name}</span>
    </Link>
  );
}

export function BudgetSection({ a, b }: Props) {
  const rows: { label: string; val: (c: Cmp) => React.ReactNode; warn?: (c: Cmp) => boolean }[] = [
    { label: 'Ruleset', val: c => <span className="truncate" title={c.ruleset.label}>{c.ruleset.label}</span> },
    { label: 'Points used', val: c => <span className={cn(c.v.used > c.v.budget && 'text-loss')}>{c.v.used} / {c.v.budget}</span> },
    { label: 'Remaining', val: c => <span className={cn(c.v.remaining < 0 && 'text-loss')}>{c.v.remaining}</span> },
    { label: 'Roster', val: c => `${c.v.count} / ${c.v.rosterSize}` },
    { label: 'Captains', val: c => <span className="inline-flex items-center gap-1"><Sparkles size={11} className="text-pink-400" />{c.team.roster.filter(m => m.captain).length}</span> },
    { label: 'Rule warnings', val: c => { const n = warnCount(c.v); return <span className={cn('inline-flex items-center gap-1', n > 0 && 'text-amber-400')}>{n > 0 && <TriangleAlert size={11} />}{n}</span>; } },
  ];
  return (
    <Section title="Budget & rules">
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 items-center text-xs font-mono tabular-nums">
        <span />
        {[a, b].map((c, i) => (
          <Link key={i} to={`/draft-center/team/${c.team.id}`} className={cn('truncate font-semibold hover:underline', SIDE_STYLE[i ? 'b' : 'a'].text)}>{c.team.name}</Link>
        ))}
        {rows.map(r => (
          <Fragment key={r.label}>
            <span className="text-text-muted">{r.label}</span>
            <span className="min-w-0 truncate flex">{r.val(a)}</span>
            <span className="min-w-0 truncate flex">{r.val(b)}</span>
          </Fragment>
        ))}
      </div>
    </Section>
  );
}

export function TypesSection({ a, b }: Props) {
  const ta = useMemo(() => typeTotals(a.team.roster, a.ruleset), [a]);
  const tb = useMemo(() => typeTotals(b.team.roster, b.ruleset), [b]);
  const holesA = holesOf(ta), holesB = holesOf(tb);
  const net = ta.reduce((s, t, i) => s + Math.sign(typeScore(t) - typeScore(tb[i])), 0);

  const cell = (t: { weak: number; resist: number }, win: boolean, hole: boolean) => (
    <td className={cn('px-2 py-0.5 text-center font-mono tabular-nums', win && 'bg-win/10', hole && 'text-loss font-bold')}>
      <span className={t.weak > 0 ? 'text-loss' : 'text-text-muted'}>{t.weak}</span>
      <span className="text-text-muted"> / </span>
      <span className={t.resist > 0 ? 'text-win' : 'text-text-muted'}>{t.resist}</span>
    </td>
  );

  return (
    <Section title="Type chart" hint="weak / resist counts; shaded = better matchup">
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs">
        {([['a', holesA], ['b', holesB]] as [Side, string[]][]).map(([side, holes]) => (
          <div key={side} className="flex items-center gap-1.5 flex-wrap">
            <SideTag side={side} />
            <span className="text-text-muted">holes:</span>
            {holes.length === 0 ? <span className="text-win">none</span> : holes.map(h => (
              <span key={h} className="rounded px-1.5 text-[9px] font-bold uppercase text-white leading-4" style={{ backgroundColor: TYPE_COLORS[h as keyof typeof TYPE_COLORS] }}>{h}</span>
            ))}
          </div>
        ))}
        <span className="ml-auto text-text-muted">
          Overall: {net === 0 ? 'even' : <span className={SIDE_STYLE[net > 0 ? 'a' : 'b'].text}>{net > 0 ? 'A' : 'B'} better on {Math.abs(net)} more types</span>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] font-mono uppercase text-text-muted">
              <th className="px-2 py-1 text-left font-medium">Type</th>
              <th className={cn('px-2 py-1 font-medium', SIDE_STYLE.a.text)}>A</th>
              <th className={cn('px-2 py-1 font-medium', SIDE_STYLE.b.text)}>B</th>
            </tr>
          </thead>
          <tbody>
            {ta.map((t, i) => {
              const d = typeScore(t) - typeScore(tb[i]);
              return (
                <tr key={t.type} className="border-t border-border-subtle/50">
                  <td className="px-2 py-0.5">
                    <span className="inline-block rounded px-1.5 text-[9px] font-bold uppercase text-white leading-4" style={{ backgroundColor: TYPE_COLORS[t.type] }}>{t.type}</span>
                  </td>
                  {cell(t, d > 0, holesA.includes(t.type))}
                  {cell(tb[i], d < 0, holesB.includes(t.type))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function SpeedSection({ a, b }: Props) {
  const ladder = useMemo(() => mergedSpeedLadder(a.team.roster, b.team.roster, a.ruleset), [a, b]);
  if (ladder.length === 0) return <Section title="Speed"><p className="text-xs text-text-muted">Both teams are empty.</p></Section>;
  return (
    <Section title="Speed" hint="fastest first by base Spe; shows how many opposing mons each outspeeds">
      <div className="overflow-x-auto">
        <div className="min-w-72 max-w-lg mx-auto flex flex-col">
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem_3rem_3.5rem] gap-x-2 px-1 pb-1 text-[10px] font-mono uppercase tracking-widest text-text-muted">
            <span /><span>Pokemon</span><span className="text-right">Base</span><span className="text-right">Set</span><span className="text-right">Outspeeds</span>
          </div>
          {ladder.map(e => (
            <div key={`${e.side}-${e.name}`} className={cn('grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem_3rem_3.5rem] gap-x-2 items-center px-1 py-[2px] border-l-2 border-t border-t-border-subtle/40', SIDE_STYLE[e.side].border)}>
              <SideTag side={e.side} className="text-[10px]" />
              <MonLink name={e.name} className={SIDE_STYLE[e.side].text} />
              <span className="text-right text-xs font-mono font-bold tabular-nums">{e.base}</span>
              <span className="text-right text-xs font-mono tabular-nums text-text-secondary">{e.set ?? empty}</span>
              <span className="text-right text-xs font-mono tabular-nums text-text-muted">{outspeeds(ladder, e)}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function RolesSection({ a, b }: Props) {
  const [cats, setCats] = useState<MoveCategory[]>(DEFAULT_MOVE_CATEGORIES);
  useEffect(() => { let c = false; loadCategories().then(x => { if (!c) setCats(x); }); return () => { c = true; }; }, []);
  const ra = useMemo(() => roleChecklist(a.team.roster, a.ruleset, cats), [a, cats]);
  const rb = useMemo(() => roleChecklist(b.team.roster, b.ruleset, cats), [b, cats]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; a: boolean; b: boolean }[]>();
    ra.forEach((r, i) => m.set(r.category, [...(m.get(r.category) ?? []), { name: r.entry.name, a: r.has, b: rb[i]?.has ?? false }]));
    return [...m];
  }, [ra, rb]);

  const mark = (v: boolean, side: Side) => v
    ? <Check size={14} className={SIDE_STYLE[side].text} aria-label="covered" />
    : <Minus size={14} className="text-text-muted/50" aria-label="not covered" />;

  return (
    <Section title="Roles" hint="on-set moves when sets exist, otherwise learnsets">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
        {groups.map(([cat, rows]) => {
          const ca = rows.filter(r => r.a).length, cb = rows.filter(r => r.b).length;
          return (
            <div key={cat} className="rounded-md border border-border-subtle overflow-hidden">
              <div className="flex items-center gap-2 px-2 py-1 bg-surface-overlay/40 text-xs font-semibold">
                <span className="truncate min-w-0 flex-1">{cat}</span>
                <span className="font-mono text-[10px] tabular-nums"><span className={SIDE_STYLE.a.text}>{ca}</span> <span className="text-text-muted">v</span> <span className={SIDE_STYLE.b.text}>{cb}</span></span>
              </div>
              {rows.map(r => (
                <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_2rem_2rem] items-center px-2 py-[3px] border-t border-border-subtle/50 text-[11px]">
                  <span className="truncate min-w-0">{r.name}</span>
                  <span className="flex justify-center">{mark(r.a, 'a')}</span>
                  <span className="flex justify-center">{mark(r.b, 'b')}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function SharedSection({ a, b }: Props) {
  const { shared, onlyA, onlyB } = useMemo(() => sharedUnique(a.team.roster, b.team.roster), [a, b]);
  const col = (title: React.ReactNode, names: string[]) => (
    <div className="min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-1">{title} <span className="tabular-nums">{names.length}</span></div>
      <div className="flex flex-col gap-0.5">{names.length === 0 ? empty : names.map(n => <MonLink key={n} name={n} />)}</div>
    </div>
  );
  return (
    <Section title="Shared / unique">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {col(<>Only <SideTag side="a" /></>, onlyA)}
        {col('Shared', shared)}
        {col(<>Only <SideTag side="b" /></>, onlyB)}
      </div>
    </Section>
  );
}
