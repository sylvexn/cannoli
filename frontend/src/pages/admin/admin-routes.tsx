/**
 * Per-tab wrapper components for the sub-routed admin panel. Each wraps the
 * underlying admin-* component in <AdminSection /> so every sub-route gets
 * consistent header chrome (icon + monospace title + optional sub-tab strip).
 *
 * Pin definitions and Pin award are split into two sibling routes that share
 * the same /admin/pins parent header (with sub-tab nav). Other tabs are 1:1.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AdminSection } from './admin-section';
import { AdminUsers } from './admin-users';
import { AdminTeams } from './admin-teams';
import { AdminLeagues } from './admin-leagues';
import { AdminSeason } from './admin-season';
import { AdminMatches } from './admin-matches';
import { AdminTrades } from './admin-trades';
import { AdminFreeAgents } from './admin-free-agents';
import { AdminTierList } from './admin-tier-list';
import { AdminMoveCategories } from './admin-move-categories';
import { AdminSiteSettings } from './admin-site-settings';
import { AdminActivityLog } from './admin-activity-log';
import { AdminFeedback } from './admin-feedback';
import { AdminBot } from './admin-bot';
import { DefinitionsTab, AwardTab } from './admin-pins';
import {
  Users, Globe, ArrowLeftRight, ScrollText, Swords,
  CalendarCog, List, Settings, Shield, MessageSquare,
  Trophy, UserPlus, Award, Bot,
} from 'lucide-react';

export const AdminUsersRoute = () => (
  <AdminSection icon={Users} title="Users"><AdminUsers /></AdminSection>
);
export const AdminTeamsRoute = () => (
  <AdminSection icon={Shield} title="Teams"><AdminTeams /></AdminSection>
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
export const AdminFeedbackRoute = () => (
  <AdminSection icon={MessageSquare} title="Feedback"><AdminFeedback /></AdminSection>
);
export const AdminBotRoute = () => (
  <AdminSection icon={Bot} title="PS Bot"><AdminBot /></AdminSection>
);

const PIN_SUBTABS = [
  { to: '/admin/pins/definitions', label: 'Definitions' },
  { to: '/admin/pins/award',       label: 'Award' },
];

export const AdminPinsDefinitionsRoute = () => (
  <AdminSection icon={Award} title="Pins" subTabs={PIN_SUBTABS}>
    <DefinitionsTab />
  </AdminSection>
);
export const AdminPinsAwardRoute = () => (
  <AdminSection icon={Award} title="Pins" subTabs={PIN_SUBTABS}>
    <AwardTab />
  </AdminSection>
);

/** Bare /admin/pins lands on the definitions sub-tab. */
export const AdminPinsIndexRoute = () => <Navigate to="definitions" replace />;

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
    } catch (err: any) {
      toast.error(err?.message ?? 'Backfill failed');
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
