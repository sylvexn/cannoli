import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trophy } from 'lucide-react';
import { api, type ApiPublicProfile, type ApiPin, type ApiActivityEvent } from '@/lib/api';
import { CoachAvatar } from '@/components/coach-avatar';
import { Pin } from '@/components/pin';
import { TeamLogo } from '@/components/team-logo';
import { EmptyState } from '@/components/empty-state';
import { PageLoadingSpinner } from '@/components/skeletons';
import { formatRelativeTime, formatRecord, formatTenure } from '@/lib/format';
import { cn } from '@/lib/utils';

const FALLBACK_PRIMARY = '#7dd3fc';
const FALLBACK_SECONDARY = '#a78bfa';
const FALLBACK_TERTIARY = '#fb7185';

export function CoachProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [pins, setPins] = useState<ApiPin[]>([]);
  const [activity, setActivity] = useState<ApiActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
      // Filter activity log to events where this user was the actor
      const events = (log as { events?: ApiActivityEvent[] }).events ?? [];
      setActivity(events.filter(e => e.actor === username));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [username]);

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
  const tertiary = profile.tertiaryColor ?? FALLBACK_TERTIARY;
  const display = profile.displayName?.trim() || profile.username;
  const seasonNumber = seasonFromCreatedAt(profile.createdAt);

  // Banner uses the user's three accent colors as a faceted gradient — mirrors
  // the gemstone treatment used elsewhere but personalized to the coach.
  const bannerStyle = {
    background:
      `linear-gradient(135deg, ${primary}55 0%, ${secondary}40 45%, ${tertiary}35 100%),` +
      `radial-gradient(ellipse 60% 70% at 30% 30%, ${primary}30 0%, transparent 60%),` +
      `radial-gradient(ellipse 60% 70% at 70% 80%, ${tertiary}25 0%, transparent 60%)`,
  };

  const nameStyle = {
    backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
    WebkitBackgroundClip: 'text' as const,
    backgroundClip: 'text' as const,
    color: 'transparent',
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-8">
      {/* Banner + identity strip */}
      <div className="relative rounded-xl overflow-hidden border border-border-default bg-surface-raised">
        <div className="h-32 w-full" style={bannerStyle} />

        {/* Identity overlay */}
        <div className="px-5 pt-3 pb-4 flex items-start gap-4 relative">
          <div className="-mt-12 shrink-0">
            <CoachAvatar
              username={profile.username}
              displayName={profile.displayName}
              avatarPath={profile.avatarPath}
              primaryColor={primary}
              secondaryColor={secondary}
              size={88}
              className="ring-4 ring-surface-raised"
            />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h1
              className="text-2xl font-bold leading-tight truncate"
              style={nameStyle}
            >
              {display}
            </h1>
            {profile.displayName && profile.displayName !== profile.username && (
              <div className="text-xs font-mono text-text-muted mt-0.5">@{profile.username}</div>
            )}
            {profile.bio && (
              <p className="text-sm text-text-secondary mt-2 leading-snug max-w-prose">
                {profile.bio}
              </p>
            )}
          </div>
          {seasonNumber != null && (
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                {formatTenure(seasonNumber)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Trophy case + Career stats — side by side on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <TrophyCase pins={pins} />
        <CareerSummary profile={profile} />
      </div>

      {/* Current teams */}
      {profile.currentTeams.length > 0 && (
        <CurrentTeams teams={profile.currentTeams} />
      )}

      {/* Recent moments */}
      <RecentMoments activity={activity} />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function TrophyCase({ pins }: { pins: ApiPin[] }) {
  return (
    <div className="lg:col-span-2 rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
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
              awardedAt={pin.awardedAt}
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

function CareerSummary({ profile }: { profile: ApiPublicProfile }) {
  const c = profile.careerSummary;
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-3">
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

function CurrentTeams({ teams }: { teams: ApiPublicProfile['currentTeams'] }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-3">
        Current teams
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {teams.map(t => (
          <Link
            key={t.teamId}
            to={`/league/${t.leagueId}/teams/${t.teamId}`}
            className={cn(
              'card-interactive flex items-center gap-3 rounded-lg border border-border-default bg-surface-overlay/40 px-3 py-2.5',
            )}
            style={{
              ['--card-accent' as never]: t.teamColor,
              ['--card-glow' as never]: `${t.teamColor}30`,
            }}
          >
            <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} size="md" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-primary truncate">{t.teamName}</div>
              <div className="text-[10px] font-mono text-text-muted">{t.teamAbbrev}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function RecentMoments({ activity }: { activity: ApiActivityEvent[] }) {
  return (
    <div className="rounded-xl border border-border-default bg-surface-raised p-4">
      <h2 className="text-xs font-mono uppercase tracking-wider text-text-muted mb-3">
        Recent moments
      </h2>
      {activity.length > 0 ? (
        <ul className="space-y-1.5">
          {activity.slice(0, 10).map(e => (
            <li
              key={e.id}
              className="flex items-baseline gap-2 text-[12px] text-text-secondary border-b border-border-subtle/40 last:border-b-0 pb-1.5 last:pb-0"
            >
              <span className="flex-1 leading-snug">{e.description}</span>
              <span className="shrink-0 text-[10px] font-mono text-text-muted">
                {formatRelativeTime(e.timestamp)}
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

/**
 * Approximate season number from account creation date.
 * Cannoli S1 began roughly mid-2023; treating each season as ~3 months.
 * TODO: replace with a real `joinedSeasonNumber` field from the backend.
 */
function seasonFromCreatedAt(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  const epoch = new Date('2023-06-01').getTime();
  const elapsedMs = d.getTime() - epoch;
  if (elapsedMs < 0) return 1;
  const seasons = Math.floor(elapsedMs / (90 * 24 * 60 * 60 * 1000));
  return Math.max(1, seasons + 1);
}
