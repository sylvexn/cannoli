/**
 * Admin Center mockups (design phase). Static fake data only; nothing here
 * calls the API. Mounted at /admin/mockups/admin-center/*.
 *
 * The mockup draws its own proposed sidebar inside the content pane (the live
 * admin sidebar stays visible to its left while this is a mockup).
 */
import { createContext, useContext, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ExternalLink, FlaskConical, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { BASE, NAV, TICKETS, type Ticket } from './data';
import { Dashboard } from './dashboard';
import { SettingsConsole } from './settings-console';
import { TicketsPage, TicketDetail } from './tickets';
import { DevConsole } from './dev-console';
import { NavDesign } from './nav-design';

interface TicketsCtx { tickets: Ticket[]; setTickets: (t: Ticket[]) => void }
const Ctx = createContext<TicketsCtx>({ tickets: TICKETS, setTickets: () => {} });
export const useTickets = () => useContext(Ctx);

export function AdminCenterMockup() {
  const [tickets, setTickets] = useState<Ticket[]>(TICKETS);
  // Dev group is shown to everyone here so it can be reviewed; the real build hides it for non-dev.
  const groups = NAV;

  const item = (cls: string, content: React.ReactNode, key: string, to: string, mock: boolean) =>
    mock ? (
      <NavLink key={key} to={`${BASE}/${to}`} className={({ isActive }) => cn(cls, isActive ? 'bg-surface-overlay text-text-primary font-medium' : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40')}>
        {content}
      </NavLink>
    ) : (
      <NavLink key={key} to={`/admin/${to}`} className={cn(cls, 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay/40')} title="Existing page, unchanged">
        {content}
      </NavLink>
    );

  return (
    <Ctx.Provider value={{ tickets, setTickets }}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-draw/40 bg-draw/10 px-3 py-1.5 text-[11px] text-draw">
          <FlaskConical size={13} className="shrink-0" />
          <span className="min-w-0">Design mockup: static fake data, nothing saves. Items with an arrow open today's real page.</span>
          <NavLink to={`${BASE}/nav`} className="ml-auto shrink-0 underline underline-offset-2 inline-flex items-center gap-1"><Info size={12} />Nav rationale</NavLink>
        </div>
        <div className="flex flex-col lg:flex-row gap-4">
          <nav className="lg:w-[190px] shrink-0 lg:border-r border-border-default lg:pr-2 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <h1 className="px-3 text-lg font-mono font-bold tracking-tight uppercase">
              <span className="text-loss">Admin</span>{' '}<span>Center</span>
            </h1>
            <div className="flex lg:block gap-3 overflow-x-auto lg:overflow-visible lg:space-y-3 pb-1">
              {groups.map(g => (
                <div key={g.label} className="shrink-0 lg:shrink">
                  <div className="px-3 mb-1 text-[9px] font-mono font-bold uppercase tracking-[0.15em] text-text-muted/60" title={g.blurb}>{g.label}</div>
                  <div className="flex lg:block gap-0.5">
                    {g.items.map(i => {
                      const Icon = i.icon;
                      const content = (
                        <>
                          <Icon size={14} className="shrink-0" />
                          <span className="truncate min-w-0">{i.label}</span>
                          {i.badge ? (
                            <span className={cn('ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono font-bold tabular-nums',
                              i.tone === 'loss' ? 'bg-loss/20 text-loss' : 'bg-draw/20 text-draw')}>{i.badge}</span>
                          ) : null}
                          {i.real && !i.badge && <ExternalLink size={10} className="ml-auto shrink-0 opacity-50" />}
                        </>
                      );
                      return item('flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors min-h-7 whitespace-nowrap', content, i.label, (i.mock ?? i.real)!, !!i.mock);
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>
          <div className="flex-1 min-w-0">
            <Routes>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="settings" element={<SettingsConsole />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:id" element={<TicketDetail />} />
              <Route path="dev" element={<DevConsole />} />
              <Route path="nav" element={<NavDesign />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </Ctx.Provider>
  );
}

export function PageTitle({ a, b, accent, sub, right }: { a: string; b: string; accent: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end gap-3 flex-wrap mb-4">
      <div className="min-w-0">
        <h2 className="text-xl font-mono font-bold tracking-tight uppercase">
          <span className={accent}>{a}</span>{' '}<span>{b}</span>
        </h2>
        {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Badge variant="outline" className={cn('text-[10px] font-mono uppercase tracking-wide px-1.5 py-0 h-4', className)}>{children}</Badge>;
}
