import { NAV } from './data';
import { PageTitle } from './index';

const WHY: Record<string, string> = {
  Overview: 'Landing moves from Users to a "what needs me" page.',
  Inbox: 'Everything that waits on a human gets a badge and lives together. Tera is its own lane because it is a different decision from an FA claim.',
  'League Ops': 'Verbs for running a season. Season and Leagues merge in the nav; their config fields move to the Settings Console.',
  'People & Content': 'Accounts, what players read, and the audit trail.',
  Settings: 'One searchable console instead of five tabs; Move Categories stays standalone (bulk editor).',
  Dev: 'Dev role only. Infra and diagnostics, hidden from admins.',
};

export function NavDesign() {
  return (
    <div>
      <PageTitle a="Nav" b="Grouping" accent="text-loss" sub="Every existing tab mapped to a section; the sidebar on the left is the proposal." />
      <div className="grid gap-3 md:grid-cols-2">
        {NAV.map(g => (
          <section key={g.label} className="rounded-lg border border-border-default bg-surface-raised/30">
            <header className="px-3 py-2 border-b border-border-subtle">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wide">{g.label}</h3>
              <p className="text-[11px] text-text-muted">{WHY[g.label]}</p>
            </header>
            <ul className="divide-y divide-border-subtle">
              {g.items.map(i => (
                <li key={i.label} className="flex items-start gap-2 px-3 py-1.5 text-[12px]">
                  <i.icon size={13} className="mt-0.5 text-text-muted shrink-0" />
                  <span className="text-text-primary shrink-0">{i.label}</span>
                  <span className="text-text-muted ml-auto text-right min-w-0">{i.absorbs}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
