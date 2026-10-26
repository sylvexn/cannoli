/** Static fake data + nav model for the admin-center mockups. No API calls. */
import {
  LayoutDashboard, Inbox, ArrowLeftRight, UserPlus, Sparkles, Trophy, Globe, UsersRound,
  Shield, Users, ScrollText, SlidersHorizontal, Swords, Megaphone, Award, BarChart3,
  Terminal, Gauge, Activity, Bot, FlaskConical, CalendarCog, type LucideIcon,
} from 'lucide-react';

export const BASE = '/admin/mockups/admin-center';

export interface MockNavItem {
  label: string;
  icon: LucideIcon;
  /** Mocked screen (relative to BASE) */
  mock?: string;
  /** Existing real admin page (/admin/<slug>) kept as-is */
  real?: string;
  badge?: number;
  tone?: 'loss' | 'draw' | 'neon';
  devOnly?: boolean;
  /** Which legacy tabs this entry absorbs / how it changes */
  absorbs?: string;
}
export interface MockNavGroup { label: string; blurb: string; items: MockNavItem[] }

export const NAV: MockNavGroup[] = [
  { label: 'Overview', blurb: 'Landing page: what needs me right now?', items: [
    { label: 'Dashboard', icon: LayoutDashboard, mock: 'dashboard', absorbs: 'new (replaces Users as the /admin landing)' },
  ] },
  { label: 'Inbox', blurb: 'Every queue that waits on a human, one badge each.', items: [
    { label: 'Tickets', icon: Inbox, mock: 'tickets', badge: 7, tone: 'draw', absorbs: 'Feedback (replaced by the issue tracker)' },
    { label: 'Trades', icon: ArrowLeftRight, real: 'trades', badge: 3, tone: 'draw', absorbs: 'Trades (unchanged)' },
    { label: 'Free Agents', icon: UserPlus, real: 'free-agents', badge: 4, tone: 'draw', absorbs: 'Free Agents, FA claims only' },
    { label: 'Tera Requests', icon: Sparkles, real: 'free-agents', badge: 2, tone: 'draw', absorbs: 'Pending tera-change requests, split out of Free Agents' },
    { label: 'Playoff Approvals', icon: Trophy, real: 'matches', badge: 1, tone: 'draw', absorbs: 'new: bracket drafts awaiting approval' },
  ] },
  { label: 'League Ops', blurb: 'Run a season: structure, matches, rosters.', items: [
    { label: 'Seasons & Leagues', icon: CalendarCog, real: 'season', absorbs: 'Season + Leagues (list stays; config fields move to Settings)' },
    { label: 'Matches', icon: Swords, real: 'matches', absorbs: 'Matches (unchanged)' },
    { label: 'Teams', icon: Shield, real: 'teams', absorbs: 'Teams (unchanged)' },
    { label: 'Membership', icon: UsersRound, real: 'membership', absorbs: 'Membership (unchanged)' },
    { label: 'Pins & Awards', icon: Award, real: 'pins', absorbs: 'Pins (unchanged)' },
  ] },
  { label: 'People & Content', blurb: 'Accounts and what players read.', items: [
    { label: 'Users', icon: Users, real: 'users', absorbs: 'Users (no longer the landing page)' },
    { label: 'Announcements', icon: Megaphone, real: 'announcements', absorbs: 'Announcements (moved out of Config)' },
    { label: 'Activity Log', icon: ScrollText, real: 'activity', absorbs: 'Activity Log (moved out of System)' },
  ] },
  { label: 'Settings', blurb: 'Everything configurable, searchable in one place.', items: [
    { label: 'Settings Console', icon: SlidersHorizontal, mock: 'settings', absorbs: 'Site Settings, Rules, Templates, Tier List, league/season config' },
    { label: 'Move Categories', icon: Globe, real: 'moves', absorbs: 'Kept separate: heavy bulk editor' },
  ] },
  { label: 'Dev', blurb: 'Dev role only. Infra, not league.', items: [
    { label: 'Dev Console', icon: Terminal, mock: 'dev', devOnly: true, absorbs: 'new: deploy health + log tail' },
    { label: 'Observability', icon: Gauge, real: 'observability', devOnly: true, badge: 2, tone: 'loss', absorbs: 'Observability (unchanged)' },
    { label: 'Usage', icon: BarChart3, real: 'usage', devOnly: true, absorbs: 'Usage / Analytics (unchanged)' },
    { label: 'API Logs', icon: Activity, real: 'api-logs', devOnly: true, absorbs: 'API Logs (unchanged)' },
    { label: 'PS Bot', icon: Bot, real: 'bot', devOnly: true, absorbs: 'PS Bot (unchanged)' },
    { label: 'Simulator', icon: FlaskConical, real: 'sim', devOnly: true, absorbs: 'Simulator, mock only (unchanged)' },
  ] },
];

// ---------- Tickets ----------
export type TicketStatus = 'new' | 'triaged' | 'in_progress' | 'fixed' | 'wontfix';
export const STATUS_META: Record<TicketStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'border-neon/40 text-neon bg-neon/10' },
  triaged: { label: 'Triaged', cls: 'border-pink/40 text-pink bg-pink/10' },
  in_progress: { label: 'In progress', cls: 'border-draw/40 text-draw bg-draw/10' },
  fixed: { label: 'Fixed', cls: 'border-win/40 text-win bg-win/10' },
  wontfix: { label: "Won't fix", cls: 'border-border-default text-text-muted bg-surface-overlay/50' },
};
export const STATUS_ORDER: TicketStatus[] = ['new', 'triaged', 'in_progress', 'fixed', 'wontfix'];
export const LEAGUES = ['Ruby', 'Sapphire', 'Emerald', 'All'] as const;

export interface HistoryEntry { at: string; by: string; text: string }
export interface Ticket {
  id: string; title: string; type: 'bug' | 'idea'; status: TicketStatus; league: string;
  reporter: string; created: string; page: string; body: string;
  priority: 'low' | 'med' | 'high';
  assignee?: string; fixedIn?: string; screenshots: number;
  feedbackId?: number; github?: { n: number; closed: boolean };
  history: HistoryEntry[];
}

const h = (at: string, by: string, text: string): HistoryEntry => ({ at, by, text });

export const TICKETS: Ticket[] = [
  { id: 'CAN-142', title: 'Draft board freezes after undo on mobile', type: 'bug', status: 'new', league: 'Emerald', reporter: 'Mira_K', created: '2026-10-25 21:14', page: '/league/emerald/draft', priority: 'high', screenshots: 2, feedbackId: 318,
    body: 'After the admin undid a pick, the board stopped updating on my phone until I refreshed. Safari iOS 18.', history: [h('Oct 25 21:14', 'Mira_K', 'Submitted via in-app feedback')] },
  { id: 'CAN-141', title: 'Tera change request shows wrong captain cost', type: 'bug', status: 'triaged', league: 'Ruby', reporter: 'Dax', created: '2026-10-25 18:02', page: '/league/ruby/team/dax', priority: 'med', assignee: 'syl', screenshots: 1, feedbackId: 316,
    body: 'Requested tera change on my tier 7 captain; the dialog says cost 8, should be 9.', history: [h('Oct 25 18:02', 'Dax', 'Submitted'), h('Oct 25 19:40', 'syl', 'Triaged, priority med')] },
  { id: 'CAN-140', title: 'Show week deadline countdown on schedule page', type: 'idea', status: 'triaged', league: 'All', reporter: 'Poppy', created: '2026-10-24 12:30', page: '/league/sapphire/schedule', priority: 'low', screenshots: 0, feedbackId: 311,
    body: 'Would love a small "closes in 2d 4h" chip next to each week.', history: [h('Oct 24 12:30', 'Poppy', 'Submitted'), h('Oct 24 15:00', 'syl', 'Triaged')] },
  { id: 'CAN-139', title: 'Replay import fails for battles with Zoroark', type: 'bug', status: 'in_progress', league: 'Sapphire', reporter: 'Teo', created: '2026-10-23 09:11', page: '/league/sapphire/match/88', priority: 'high', assignee: 'syl', screenshots: 1, feedbackId: 305,
    body: 'Replay parse errors out with "unknown species" whenever Illusion reveals.', history: [h('Oct 23 09:11', 'Teo', 'Submitted'), h('Oct 23 10:05', 'syl', 'Triaged'), h('Oct 24 08:00', 'syl', 'Moved to In progress')] },
  { id: 'CAN-138', title: 'Trade block: filter by tier', type: 'idea', status: 'new', league: 'Emerald', reporter: 'Lux', created: '2026-10-23 07:50', page: '/league/emerald/trade-block', priority: 'low', screenshots: 0, feedbackId: 304,
    body: 'Filter listings by tier so I can find 5-cost mons fast.', history: [h('Oct 23 07:50', 'Lux', 'Submitted')] },
  { id: 'CAN-137', title: 'Standings tiebreak differs from rules page', type: 'bug', status: 'fixed', league: 'Ruby', reporter: 'Nova', created: '2026-10-20 20:00', page: '/league/ruby/standings', priority: 'med', assignee: 'syl', fixedIn: 'v1.3', screenshots: 0, feedbackId: 290,
    body: 'Head-to-head should come before differential.', history: [h('Oct 20 20:00', 'Nova', 'Submitted'), h('Oct 21 09:00', 'syl', 'Triaged'), h('Oct 22 13:20', 'syl', 'Fixed in v1.3, reporter notified')] },
  { id: 'CAN-136', title: 'Pokemon page: moves tab blank for Ogerpon forms', type: 'bug', status: 'fixed', league: 'All', reporter: 'Ash_L', created: '2026-10-18 11:45', page: '/pokemon/ogerpon-wellspring', priority: 'low', fixedIn: 'v1.2.1', screenshots: 1, github: { n: 212, closed: true },
    body: 'Moves tab renders empty for non-base forms.', history: [h('Oct 18 11:45', 'import', 'Imported from GitHub issue #212'), h('Oct 19 16:00', 'syl', 'Fixed in v1.2.1')] },
  { id: 'CAN-135', title: 'Allow dark/light theme switch', type: 'idea', status: 'wontfix', league: 'All', reporter: 'Bo', created: '2026-10-15 19:20', page: '/settings', priority: 'low', screenshots: 0, github: { n: 198, closed: true },
    body: 'Out of scope: the app is dark-only by design.', history: [h('Oct 15 19:20', 'import', 'Imported from GitHub issue #198'), h('Oct 16 08:10', 'syl', "Won't fix: design decision")] },
  { id: 'CAN-134', title: 'Arena lobby lists finished battles', type: 'bug', status: 'in_progress', league: 'Emerald', reporter: 'Rue', created: '2026-10-14 22:05', page: '/arena', priority: 'med', assignee: 'syl', screenshots: 1, github: { n: 205, closed: false },
    body: 'Finished battles stay in the lobby list until a refresh.', history: [h('Oct 14 22:05', 'import', 'Imported from GitHub issue #205'), h('Oct 22 10:00', 'syl', 'Moved to In progress')] },
  { id: 'CAN-133', title: 'Daily digest of pending trades', type: 'idea', status: 'new', league: 'Sapphire', reporter: 'Fen', created: '2026-10-26 08:02', page: '/league/sapphire/trades', priority: 'low', screenshots: 0, feedbackId: 321,
    body: 'Daily Discord ping listing trades that need my response.', history: [h('Oct 26 08:02', 'Fen', 'Submitted')] },
  { id: 'CAN-132', title: 'Team page loads slowly with 3 seasons of history', type: 'bug', status: 'new', league: 'All', reporter: 'Ivy', created: '2026-10-26 07:30', page: '/league/ruby/team/ivy', priority: 'med', screenshots: 0, feedbackId: 320,
    body: 'Takes about 6s on first load.', history: [h('Oct 26 07:30', 'Ivy', 'Submitted')] },
];

export const PATCH_VERSIONS = ['v1.3', 'v1.2.1', 'v1.2', 'v1.1'];

// ---------- Dashboard ----------
export interface QueueItem { who: string; what: string; league: string; age: string }
export const FA_APPROVALS: QueueItem[] = [
  { who: 'Dax', what: 'Add Garganacl, drop Mimikyu', league: 'Ruby', age: '3h' },
  { who: 'Lux', what: 'Add Rillaboom, drop Zapdos', league: 'Emerald', age: '9h' },
  { who: 'Nova', what: 'Add Gliscor, drop Heatran', league: 'Ruby', age: '1d' },
  { who: 'Fen', what: 'Add Hatterene, drop Ditto', league: 'Sapphire', age: '2d' },
];
export const TERA_APPROVALS: QueueItem[] = [
  { who: 'Dax', what: 'Garchomp: Ground/Steel/Fire to Ground/Dragon/Steel', league: 'Ruby', age: '5h' },
  { who: 'Mira_K', what: 'Kingambit: Dark/Fighting/Flying to Dark/Steel/Fighting', league: 'Emerald', age: '1d' },
];
export const TRADE_APPROVALS: QueueItem[] = [
  { who: 'Teo / Rue', what: 'Zoroark-H for Gholdengo + pick', league: 'Sapphire', age: '2h' },
  { who: 'Poppy / Ivy', what: 'Landorus-T for Rotom-W', league: 'Emerald', age: '6h' },
  { who: 'Bo / Ash_L', what: 'Dragonite for Hydreigon', league: 'Ruby', age: '2d' },
];
export const PLAYOFF_APPROVALS: QueueItem[] = [
  { who: 'Ruby bracket, draft 2', what: 'Top 6 double elim, seeded by record, 2 byes', league: 'Ruby', age: '4h' },
];
export const ALERTS = [
  { level: 'loss', what: 'TypeError in /api/matches/:id/replay (14 events)', src: 'Observability', age: '12m' },
  { level: 'draw', what: 'PS bot reconnected 3x in the last hour', src: 'PS Bot', age: '40m' },
  { level: 'loss', what: 'cannoli-ps-client deploy failed (build exit 137)', src: 'Dev Console', age: '2h' },
];

// ---------- Dev console ----------
export const APPS = [
  { name: 'cannoli-frontend-live', url: 'cannoli.live', version: 'v1.2.1', commit: '1066442', deployed: '2h ago', ci: 'pass', health: 'healthy' },
  { name: 'cannoli-backend-live', url: 'internal', version: 'v1.2.1', commit: '1066442', deployed: '2h ago', ci: 'pass', health: 'healthy' },
  { name: 'cannoli-ps-server', url: 'internal', version: 'showdown fork', commit: '9c41ae0', deployed: '6d ago', ci: 'pass', health: 'healthy' },
  { name: 'cannoli-ps-client', url: 'sim.cannoli.live', version: 'client-4f2', commit: '7ab31d2', deployed: '2h ago', ci: 'fail', health: 'degraded' },
  { name: 'cannoli-frontend-mock', url: 'mock.cannoli.live', version: 'v1.3-dev', commit: '5be90c1', deployed: '25m ago', ci: 'running', health: 'healthy' },
  { name: 'cannoli-backend-mock', url: 'internal', version: 'v1.3-dev', commit: '5be90c1', deployed: '25m ago', ci: 'running', health: 'healthy' },
  { name: 'cannoli-maintenance', url: 'none', version: 'static', commit: 'a01c9d3', deployed: '41d ago', ci: 'pass', health: 'stopped' },
];
