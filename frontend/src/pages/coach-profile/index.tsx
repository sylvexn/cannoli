import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trophy, Pencil, ChevronRight, Globe, ArrowUpRight } from 'lucide-react';
import { TeamColorChip, RoleChip, FinishBadge } from './chips';
import { api, type ApiPublicProfile, type ApiPin, type ApiActivityEvent } from '@/lib/api';
import { CoachAvatar } from '@/components/coach-avatar';
import { Pin } from '@/components/pin';
import { TeamLogo } from '@/components/team-logo';
import { EmptyState } from '@/components/empty-state';
import { PageLoadingSpinner } from '@/components/skeletons';
import { formatRelativeTime, formatRecord } from '@/lib/format';
import { useAuth } from '@/lib/auth-context';
import { ProfileSettingsPanel } from './settings-panel';
import { useCoachExtras, type CoachResult } from './use-coach-extras';
import { WinRateSparkline } from './win-rate-sparkline';
import { RecentHighlights } from './recent-highlights';

const FALLBACK_PRIMARY = '#7dd3fc';
const FALLBACK_SECONDARY = '#a78bfa';

export function CoachProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const { user: viewer, isAdmin } = useAuth();
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [pins, setPins] = useState<ApiPin[]>([]);
  const [activity, setActivity] = useState<ApiActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Self vs staff edit. `isAdmin` already covers dev|admin via the auth
  // context, mirroring the backend's `isStaff()`. Owners always edit; staff
  // get a separate write path that emits a `profile_edited_by_staff` audit
  // event so the activity feed can distinguish the two cases.
  const isSelf = !!viewer && viewer.username.toLowerCase() === username.toLowerCase();
  const canEdit = isSelf || (!!viewer && isAdmin);

  async function refetch() {
    const prof = await api.getPublicProfile(username).catch(() => null);
    if (prof) setProfile(prof);
  }

  useEffect(() => {
    if (!username) return;

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    Promise.all([
      api.getPublicProfile(username).catch(() => null),
      api.getUserPins(username).catch(() => [] as ApiPin[]),
      api.getActivityLog({ search: username, limit: 12 }).catch(() => ({ events: [] })),
    ]).then(([prof, userPins, log]) => {
      if (cancelled) return;
      if (!prof) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setProfile(prof);
      setPins(userPins);
      // Filter activity log to events where this user was the actor.
      // Exclude admin-category events: the public wall must not leak staff
      // actions (force-picks, role changes, pin grants, etc.) even when the
      // viewer happens to be staff and the endpoint returns them.
      const events = (log as { events?: ApiActivityEvent[] }).events ?? [];
      setActivity(events.filter(e => e.actor === username && e.category !== 'admin'));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [username]);

  // Derived data for the enriched panels (sparkline + career stats).
  // Lives outside the main fetch so the profile header paints immediately
  // and the extras swap in once the per-league fetches resolve.
  const extras = useCoachExtras(profile);

  if (loading) return <PageLoadingSpinner />;

  if (notFound || !profile) {
    return (
      <EmptyState
        variant="not-found"
        title="Coach not found."
        subtitle={`Nobody named "${username}" plays here.`}
        action={
          <Link to="/" className="text-neon hover:underline text-sm inline-flex items-center gap-1">
            <ArrowLeft size={12} />
            Back to overview
          </Link>
        }
      />
    );
  }

  const primary = profile.primaryColor ?? FALLBACK_PRIMARY;
  const secondary = profile.secondaryColor ?? FALLBACK_SECONDARY;
  const display = profile.displayName?.trim() || profile.username;

  // Pick the first current-team tenure as the user's "active team" — spec:
  // 1 user / 1 league / 1 season. The backend filters currentTeams to teams
  // belonging to non-archived seasons, so any entry here is current. The
  // team's color drives the avatar glow ring and a small chip; falls back
  // to the user's profile primary when the user isn't coaching.
  const heroTeam = profile.currentTeams[0] ?? null;
  const ringColor = heroTeam?.teamColor ?? primary;

  const nameStyle = {
    backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
    WebkitBackgroundClip: 'text' as const,
    backgroundClip: 'text' as const,
    color: 'transparent',
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-8">
      {/* ─── Identity strip ──────────────────────────────────────────────
          Replaces the old gemstone-gradient banner. The avatar gets a
          team-color glow ring (or the user's primary if they're not
          coaching this season). A small team-color chip sits in the
          header so the team affiliation reads even when the avatar ring
          is subtle. ADMIN/DEV chips surface staff status. */}
      <div
        className="identity-glow relative rounded-xl border border-border-default bg-surface-raised px-5 py-4 flex items-start gap-4"
        style={{ ['--identity-color' as never]: ringColor }}
      >
        <div className="shrink-0">
          <CoachAvatar
            username={profile.username}
            displayName={profile.displayName}
            avatarPath={profile.avatarPath}
            primaryColor={primary}
            secondaryColor={secondary}
            size="2xl"
            // Glow ring uses the active team's color when the user is
            // coaching, otherwise the profile primary.
            ringColor={ringColor}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h1
              className="text-2xl font-bold leading-tight truncate font-heading"
              style={nameStyle}
            >
              {display}
            </h1>
            {(profile.role === 'admin' || profile.role === 'dev' || profile.role === 'bot') && (
              <RoleChip role={profile.role} />
            )}
            {heroTeam && (
              <TeamColorChip
                color={heroTeam.teamColor}
                abbrev={heroTeam.teamAbbrev}
              />
            )}
          </div>

          {profile.displayName && profile.displayName !== profile.username && (
            <div className="text-xs font-mono text-text-muted mt-0.5">@{profile.username}</div>
          )}
          {profile.statusMessage && (
            <p
              className="mt-2 text-sm font-heading italic text-text-primary/90 leading-snug max-w-prose"
              style={{ color: secondary }}
            >
              {profile.statusMessage}
            </p>
          )}
          {profile.bio && (
            <p className="text-sm text-text-secondary mt-2 leading-snug max-w-prose whitespace-pre-line">
              {profile.bio}
            </p>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border-default bg-surface-overlay/40 hover:bg-surface-overlay hover:border-neon/40 hover:text-neon text-[10px] font-mono uppercase tracking-wider text-text-muted transition-colors"
              title={isSelf ? 'Edit your profile' : 'Edit as staff (logged)'}
            >
              <Pencil size={10} />
              {isSelf ? 'Edit' : 'Edit (staff)'}
            </button>
          )}
        </div>
      </div>

      {/* Settings panel — open for owner OR staff. Backend disambiguates
          via the route used (PATCH /me vs PATCH /:username). */}
      {canEdit && (
        <ProfileSettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          profile={profile}
          onSaved={refetch}
          asStaff={!isSelf}
        />
      )}

      {/* ─── Current team hero ─────────────────────────────────────────
          Shown only when the user has an active-season team. Spec:
          1 user / 1 league / 1 season — so we anchor on the first entry
          in `currentTeams`. S10 (finals pending) gets a "Finals Pending"
          pill but no champion badge; that promotes only after the season
          archives and the finals match completes. */}
      {heroTeam && (
        <CurrentTeamHero team={heroTeam} />
      )}

      {/* Trophy case + Career stats — side by side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <TrophyCase pins={pins} />
        <CareerSummary
          profile={profile}
          results={extras.results}
          accent={primary}
        />
      </div>

      {/* ─── History — past tenures with finish badges ─────────────────
          Reads `pastTeams` from the public profile (backend-computed,
          archived-season-only). Renders gracefully when empty (new user
          or backend hasn't backfilled yet). A4 is seeding S9 finish
          data in parallel — finish may be null on rows pending backfill. */}
      <HistorySection
        username={profile.username}
        pastTeams={profile.pastTeams ?? []}
      />

      {/* Dev accounts (just `syl`) don't surface an activity wall — it's all
          staff/admin actions, which the public wall is meant to hide. In its
          place we show an external-links card (GitHub + portfolio). Everyone
          else gets the normal highlights + wall. */}
      {profile.role === 'dev' ? (
        <DevLinks accent={primary} />
      ) : (
        <>
          {/* Recent highlights — top 1-3 events as larger cards. Sits above
              the long-tail wall so the most recent moments read as portraits
              rather than ledger entries. */}
          <RecentHighlights events={activity} accent={primary} />

          {/* Wall (long tail) */}
          <RecentMoments activity={activity} />
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

/** Small team-color square + abbrev pill placed in the identity header so
 *  the team affiliation reads even when the avatar's glow is subtle. The
 *  chip itself is a link to the canonical team URL — quick jump for
 *  visitors. */
// chips extracted to ./chips to keep this file under 600 LOC
/** Active-season team panel. One canonical team per spec ("1 user / 1
 *  league / 1 season"). Shows team logo, name, league/season, season
 *  phase pill, and links to the canonical team URL. The next-match
 *  banner + roster preview live on the team page itself — surfacing
 *  them here too would duplicate state and force two fetches; the panel
 *  is a hand-off, not a mirror. */
function CurrentTeamHero({
  team,
}: {
  team: NonNullable<ApiPublicProfile['currentTeams']>[number];
}) {
  const teamUrl = `/league/${team.leagueId}/teams/${team.teamId}`;
  // S10 finals-pending: the league has finished its regular season but
  // the finals match hasn't completed yet. Until then we explicitly
  // suppress champion-style badges — the season has to archive first.
  const finalsPending =
    team.leaguePhase === 'playoffs' || team.leaguePhase === 'offseason';
  const seasonLabel = team.seasonNumber != null ? `S${team.seasonNumber}` : null;

  return (
    <div
      className="rounded-xl border border-border-default bg-surface-raised p-4 relative overflow-hidden"
      style={{
        background:
          `linear-gradient(180deg, ${team.teamColor}10 0%, transparent 60%), ` +
          `var(--surface-raised, #16161e)`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: team.teamColor }}
          />
          Current team
        </h2>
        {seasonLabel && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-muted">
            {seasonLabel} · {team.leagueId}
          </span>
        )}
      </div>

      <Link
        to={teamUrl}
        className="card-interactive flex items-center gap-4 rounded-lg border border-border-default bg-surface-overlay/40 px-4 py-3 hover:border-neon/40 transition-colors group"
      >
        <TeamLogo
          abbrev={team.teamAbbrev}
          color={team.teamColor}
          logoPath={team.logoPath}
          size="xl"
          className="shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-base font-bold leading-tight truncate"
              style={{ color: team.teamColor }}
            >
              {team.teamName}
            </span>
            <span className="text-[10px] font-mono text-text-muted">{team.teamAbbrev}</span>
            {finalsPending && seasonLabel && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider shrink-0 bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
                title="Playoffs in progress — champion badge awarded after the finals."
              >
                {seasonLabel} — Finals Pending
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px] font-mono text-text-muted">
            View full team
          </div>
        </div>
        <ChevronRight
          size={16}
          className="text-text-muted shrink-0 group-hover:text-neon group-hover:translate-x-0.5 transition-all"
        />
      </Link>
    </div>
  );
}

function TrophyCase({ pins }: { pins: ApiPin[] }) {
  return (
    <div className="lg:col-span-2 rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3 flex items-center gap-1.5">
        <Trophy size={12} className="text-amber-400" />
        Trophy case
      </h2>
      {pins.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {pins.map(pin => (
            <Pin
              key={pin.id}
              def={pin.definition}
              size="lg"
              seasonId={pin.seasonId}
              metadata={pin.metadata}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          variant="quiet"
          title="No pins yet."
          subtitle="Win a championship, sweep a series, or pull off an upset to start filling this case."
          spriteSize="md"
          padding="sm"
        />
      )}
    </div>
  );
}

function CareerSummary({
  profile, results, accent,
}: {
  profile: ApiPublicProfile;
  results: CoachResult[];
  accent: string;
}) {
  const c = profile.careerSummary;
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
        Career
      </h2>
      <dl className="space-y-2">
        <Stat label="Seasons" value={String(c.seasonsPlayed)} />
        <Stat label="Record" value={formatRecord(c.careerWins, c.careerLosses)} />
        <Stat
          label="K/D"
          value={`${c.careerKills}/${c.careerDeaths}`}
          ratio={c.careerDeaths > 0 ? c.careerKills / c.careerDeaths : c.careerKills}
        />
        <Stat
          label="Titles"
          value={c.championships > 0 ? String(c.championships) : '—'}
          accent={c.championships > 0 ? '#fbbf24' : undefined}
        />
        {/* Win-rate sparkline — graceful fallback when there's no completed
            match history yet (a freshly-drafted coach pre-week-1, or someone
            in only a draft-phase league). The sparkline itself owns the
            empty-data path: zero/one points still render meaningfully. */}
        {results.length >= 2 ? (
          <div className="pt-1 border-t border-border-subtle/40 mt-1">
            <WinRateSparkline results={results} color={accent} />
          </div>
        ) : (
          <div className="pt-2 mt-1 border-t border-border-subtle/40">
            <p className="text-[10px] font-mono text-text-muted leading-snug">
              {results.length === 1
                ? 'One match in. The sparkline shows up after match two.'
                : 'No completed matches yet. Battle results will trace a recent-form line here.'}
            </p>
          </div>
        )}
      </dl>
    </div>
  );
}

function Stat({
  label, value, accent, ratio,
}: { label: string; value: string; accent?: string; ratio?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span
          className="text-sm font-bold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </span>
        {ratio !== undefined && (
          <span className="text-[10px] text-text-muted tabular-nums">
            ({ratio.toFixed(2)})
          </span>
        )}
      </dd>
    </div>
  );
}

/** Past-team history strip. Compact card per archived tenure with a finish
 *  badge when available. Trailing "View all" link routes to the dedicated
 *  teams index page. */
function HistorySection({
  username,
  pastTeams,
}: {
  username: string;
  pastTeams: NonNullable<ApiPublicProfile['pastTeams']>;
}) {
  // Show the most recent 6 tenures inline; the rest live on the teams page.
  const visible = pastTeams.slice(0, 6);
  const remaining = pastTeams.length - visible.length;

  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted">
          History
        </h2>
        {pastTeams.length > 0 && (
          <Link
            to={`/coach/${encodeURIComponent(username)}/teams`}
            viewTransition
            className="text-[10px] font-mono uppercase tracking-wider text-text-muted hover:text-neon transition-colors flex items-center gap-1"
          >
            View all
            {remaining > 0 && <span className="text-text-muted/70">({pastTeams.length})</span>}
            <ChevronRight size={11} />
          </Link>
        )}
      </div>
      {pastTeams.length === 0 ? (
        <EmptyState
          variant="quiet"
          title="No past seasons yet."
          subtitle="Archived tenures and finishing positions show up here once a season closes."
          spriteSize="md"
          padding="sm"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {visible.map(t => (
            <PastTeamCard key={`${t.leagueId}-${t.seasonNumber}`} tenure={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function PastTeamCard({
  tenure,
}: {
  tenure: NonNullable<ApiPublicProfile['pastTeams']>[number];
}) {
  // Past tenures live in archived seasons — route into the archive view
  // instead of the live /league/:id/teams/:id URL (which redirects/dies
  // for archived teams).
  return (
    <Link
      to={`/archive/${tenure.seasonId}/${tenure.leagueId}/${tenure.teamId}`}
      viewTransition
      className="card-interactive flex items-center gap-3 rounded-lg border border-border-default bg-surface-overlay/40 px-3 py-2.5"
      style={{ ['--card-accent' as never]: tenure.teamColor }}
    >
      <TeamLogo
        abbrev={tenure.teamAbbrev}
        color={tenure.teamColor}
        logoPath={tenure.logoPath}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">
            {tenure.teamName}
          </span>
          <span className="text-[9px] font-mono text-text-muted shrink-0">
            S{tenure.seasonNumber}
          </span>
        </div>
        <div className="mt-0.5">
          {tenure.finish ? (
            <FinishBadge finish={tenure.finish} />
          ) : (
            <span className="text-[10px] font-mono text-text-muted/70">
              Archived
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}


/** External-links card shown in place of the activity wall on dev profiles.
 *  `syl` is the only dev account; the links are intentionally hard-coded
 *  rather than driven off a profile field — adding a schema column for a
 *  single account isn't worth it. */
function DevLinks({ accent }: { accent: string }) {
  const links = [
    {
      href: 'https://github.com/sylvexn',
      label: 'GitHub',
      sub: 'github.com/sylvexn',
      icon: (
        <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
      ),
    },
    {
      href: 'https://syl.rest',
      label: 'Portfolio',
      sub: 'syl.rest',
      icon: <Globe size={16} />,
    },
  ];

  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
        Links
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {links.map(link => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            className="card-interactive group flex items-center gap-3 rounded-lg border border-border-default bg-surface-overlay/40 px-3 py-2.5 hover:border-neon/40 transition-colors"
            style={{ ['--card-accent' as never]: accent }}
          >
            <span
              className="shrink-0 text-text-muted group-hover:text-neon transition-colors"
              style={{ color: accent }}
            >
              {link.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-primary leading-tight">{link.label}</div>
              <div className="text-[11px] font-mono text-text-muted truncate">{link.sub}</div>
            </div>
            <ArrowUpRight
              size={14}
              className="shrink-0 text-text-muted group-hover:text-neon group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function RecentMoments({ activity }: { activity: ApiActivityEvent[] }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted">
          Wall
        </h2>
        {activity.length > 0 && (
          <span className="text-[9px] font-mono text-text-muted/70 tabular-nums">
            {activity.length} moment{activity.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {activity.length > 0 ? (
        // Tighter, scrollable feed look — narrative one-liners with a small
        // bullet, hover highlight, and a fixed max-height so long histories
        // don't push the rest of the profile off-screen.
        <ul className="space-y-0 max-h-[360px] overflow-y-auto pr-1 -mr-1">
          {activity.map(e => (
            <li
              key={e.id}
              className="flex items-start gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-surface-overlay/40 transition-colors border-b border-border-subtle/30 last:border-b-0"
            >
              <span className="mt-1 w-1 h-1 rounded-full shrink-0 bg-text-muted/40" aria-hidden />
              <span className="flex-1 leading-snug text-[12px] font-heading text-text-secondary">
                {e.description}
              </span>
              <span className="shrink-0 text-[10px] font-mono text-text-muted tabular-nums">
                {formatRelativeTime(e.timestamp ?? '')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          variant="quiet"
          title="Nothing recent."
          subtitle="Trades, picks, and match results will appear here."
          spriteSize="md"
          padding="sm"
        />
      )}
    </div>
  );
}

