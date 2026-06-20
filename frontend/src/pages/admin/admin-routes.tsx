/**
 * Per-tab wrapper components for the sub-routed admin panel. Each wraps the
 * underlying admin-* component in <AdminSection /> so every sub-route gets
 * consistent header chrome (icon + monospace title + optional sub-tab strip).
 *
 * Pin definitions and Pin award are split into two sibling routes that share
 * the same /admin/pins parent header (with sub-tab nav). Other tabs are 1:1.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { AdminSection } from './admin-section';
import { AdminUsers } from './admin-users';
import { AdminTeams } from './admin-teams';
import { AdminMembership } from './admin-membership';
import { AdminLeagues } from './admin-leagues';
import { AdminSeason } from './admin-season';
import { AdminMatches } from './admin-matches';
import { AdminTrades } from './admin-trades';
import { AdminFreeAgents } from './admin-free-agents';
import { AdminTierList } from './admin-tier-list';
import { AdminTemplates } from './admin-templates';
import { AdminMoveCategories } from './admin-move-categories';
import { AdminSiteSettings } from './admin-site-settings';
import { AdminActivityLog } from './admin-activity-log';
import { AdminApiLogs } from './admin-api-logs';
import { AdminFeedback } from './admin-feedback';
import { Observability } from './observability';
import { AdminBot } from './admin-bot';
import { PinsTab } from './admin-pins';
import { AdminSim } from './admin-sim';
import { AdminAnnouncements } from './announcements';
import { AdminRules } from './rules';
import { getErrorMessage } from '@/lib/errors';
import {
  Users, Globe, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield, MessageSquare,
  Trophy, UserPlus, Award, Bot, Layers, FlaskConical, Activity, Gauge,
  UsersRound, Megaphone, BookOpen,
} from 'lucide-react';

export const AdminUsersRoute = () => (
  <AdminSection icon={Users} title="Users"><AdminUsers /></AdminSection>
);
export const AdminTeamsRoute = () => (
  <AdminSection icon={Shield} title="Teams"><AdminTeams /></AdminSection>
);
export const AdminMembershipRoute = () => (
  <AdminSection icon={UsersRound} title="Membership"><AdminMembership /></AdminSection>
);
export const AdminLeaguesRoute = () => (
  <AdminSection icon={Globe} title="Leagues"><AdminLeagues /></AdminSection>
);
export const AdminSeasonRoute = () => (
  <AdminSection icon={CalendarCog} title="Season"><AdminSeason /></AdminSection>
);
export const AdminMatchesRoute = () => (
  <AdminSection icon={Trophy} title="Matches"><AdminMatches /></AdminSection>
);
export const AdminTradesRoute = () => (
  <AdminSection icon={ArrowLeftRight} title="Trades"><AdminTrades /></AdminSection>
);
export const AdminFreeAgentsRoute = () => (
  <AdminSection icon={UserPlus} title="Free Agents"><AdminFreeAgents /></AdminSection>
);
export const AdminTierListRoute = () => (
  <AdminSection icon={List} title="Tier List"><AdminTierList /></AdminSection>
);
export const AdminTemplatesRoute = () => (
  <AdminSection icon={Layers} title="Templates"><AdminTemplates /></AdminSection>
);
export const AdminMoveCategoriesRoute = () => (
  <AdminSection icon={Swords} title="Move Categories"><AdminMoveCategories /></AdminSection>
);
export const AdminSiteSettingsRoute = () => (
  <AdminSection icon={Settings} title="Settings"><AdminSiteSettings /></AdminSection>
);
export const AdminActivityRoute = () => {
  return (
    <AdminSection
      icon={ScrollText}
      title="Activity Log"
      actions={<BackfillPinAuditButton />}
    >
      <AdminActivityLog />
    </AdminSection>
  );
};
/**
 * Route guard for dev-only admin tabs (Observability, API Logs, PS Bot).
 * Admins are staff and can reach /admin, but these tabs are dev-tooling —
 * redirect non-dev to the admin landing tab. Mirrors the server-side
 * requireDev guard so a hand-typed URL can't render the tab.
 */
function DevOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user?.role !== 'dev') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

export const AdminApiLogsRoute = () => (
  <DevOnly>
    <AdminSection icon={Activity} title="API Logs" actions={<ClearApiLogsButton />}>
      <AdminApiLogs />
    </AdminSection>
  </DevOnly>
);
export const AdminFeedbackRoute = () => (
  <AdminSection icon={MessageSquare} title="Feedback"><AdminFeedback /></AdminSection>
);
export const AdminObservabilityRoute = () => {
  // Mark the dev's observability view as "seen" on mount so the nav unread
  // badge clears (best-effort; the badge is a pull signal, not authoritative).
  useEffect(() => { api.markObservabilitySeen().catch(() => {}); }, []);
  return (
    <DevOnly>
      <AdminSection icon={Gauge} title="Observability"><Observability /></AdminSection>
    </DevOnly>
  );
};
export const AdminBotRoute = () => (
  <DevOnly>
    <AdminSection icon={Bot} title="PS Bot"><AdminBot /></AdminSection>
  </DevOnly>
);

/** Single-tab pins admin (was Definitions / Award; merged into one
 *  season-scoped grid with per-card metadata-aware award dialogs). The
 *  legacy sub-routes redirect here so existing bookmarks still work. */
export const AdminPinsRoute = () => (
  <AdminSection icon={Award} title="Pins">
    <PinsTab />
  </AdminSection>
);
export const AdminPinsLegacyRedirect = () => <Navigate to="/admin/pins" replace />;

export const AdminAnnouncementsRoute = () => (
  <AdminSection icon={Megaphone} title="Announcements"><AdminAnnouncements /></AdminSection>
);

export const AdminRulesRoute = () => (
  <AdminSection icon={BookOpen} title="Rules"><AdminRules /></AdminSection>
);

/**
 * Season Simulator route — mock-mode only.
 *
 * Probes /api/health on mount; redirects to /admin when the backend is in
 * live mode (the simulator API is mock-gated server-side, so this is purely
 * a UX guard so the route is never reachable on a live deployment). The
 * page renders its own monospace split-color header, so it isn't wrapped in
 * <AdminSection>.
 */
export const AdminSimRoute = () => {
  const [mode, setMode] = useState<'live' | 'mock' | 'loading'>('loading');
  useEffect(() => {
    api.getHealth().then(h => setMode(h.mode)).catch(() => setMode('live'));
  }, []);
  if (mode === 'loading') {
    return <div className="py-12 text-center text-sm text-text-muted font-mono">Checking deployment mode…</div>;
  }
  if (mode !== 'mock') return <Navigate to="/admin" replace />;
  return (
    <AdminSection icon={FlaskConical} title="Simulator">
      <AdminSim />
    </AdminSection>
  );
};

/**
 * Header action for the Activity Log: trigger pin audit-log backfill.
 * Idempotent — safe to click repeatedly. Reports inserted/skipped counts.
 */
function BackfillPinAuditButton() {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm('Backfill pin_awarded events for any pins missing them? Idempotent — safe to re-run.')) return;
    setBusy(true);
    try {
      const r = await api.backfillPinAudit();
      if (r.inserted > 0) {
        toast.success(`Inserted ${r.inserted} pin_awarded entries (${r.skipped} already logged)`);
      } else {
        toast.info(`Already up to date (${r.skipped} pin events already logged)`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Backfill failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={run} disabled={busy} className="h-7 text-[11px]">
      {busy ? 'Backfilling...' : 'Backfill pin events'}
    </Button>
  );
}

/**
 * Header action for API Logs: wipe the request_logs table. Confirms first —
 * the log auto-prunes anyway, so this is mostly for clearing noise before a
 * focused debugging session. Reloads the tab so the cleared state shows.
 */
function ClearApiLogsButton() {
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm('Clear all API request logs? This cannot be undone.')) return;
    setBusy(true);
    try {
      const r = await api.clearRequestLogs();
      toast.success(`Cleared ${r.cleared} request log${r.cleared === 1 ? '' : 's'}`);
      window.location.reload();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Clear failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={run} disabled={busy} className="h-7 text-[11px]">
      {busy ? 'Clearing...' : 'Clear logs'}
    </Button>
  );
}
