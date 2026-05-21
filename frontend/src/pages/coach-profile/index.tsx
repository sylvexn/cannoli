import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Trophy, Pencil } from 'lucide-react';
import { api, type ApiPublicProfile, type ApiPin, type ApiActivityEvent } from '@/lib/api';
import { CoachAvatar } from '@/components/coach-avatar';
import { Pin } from '@/components/pin';
import { TeamLogo } from '@/components/team-logo';
import { EmptyState } from '@/components/empty-state';
import { PageLoadingSpinner } from '@/components/skeletons';
import { formatRelativeTime, formatRecord, formatTenure } from '@/lib/format';
import { spriteUrl, type PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { ProfileSettingsPanel } from './settings-panel';

const FALLBACK_PRIMARY = '#7dd3fc';
const FALLBACK_SECONDARY = '#a78bfa';
const FALLBACK_TERTIARY = '#fb7185';

export function CoachProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const { user: viewer } = useAuth();
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [pins, setPins] = useState<ApiPin[]>([]);
  const [activity, setActivity] = useState<ApiActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Self-only settings: viewer is the same person as the profile being viewed.
  const isSelf = !!viewer && viewer.username.toLowerCase() === username.toLowerCase();

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

  // Banner — when the user has uploaded a custom banner_url, layer it on top
  // of the gemstone gradient (the gradient peeks through transparent edges
  // and acts as a graceful fallback if the image 404s). Default falls back
  // to the pure gradient.
  const bannerGradient =
    `linear-gradient(135deg, ${primary}55 0%, ${secondary}40 45%, ${tertiary}35 100%),` +
    `radial-gradient(ellipse 60% 70% at 30% 30%, ${primary}30 0%, transparent 60%),` +
    `radial-gradient(ellipse 60% 70% at 70% 80%, ${tertiary}25 0%, transparent 60%)`;
  const bannerStyle = profile.bannerUrl
    ? {
        backgroundImage: `linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.35) 100%), url(${profile.bannerUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { background: bannerGradient };

  const nameStyle = {
    backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
    WebkitBackgroundClip: 'text' as const,
    backgroundClip: 'text' as const,
    color: 'transparent',
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto pb-8">
      {/* Banner + identity strip */}
      <div
        className="identity-glow relative rounded-xl overflow-hidden border border-border-default bg-surface-raised"
        style={{ ['--identity-color' as never]: primary }}
      >
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
              size="2xl"
              className="ring-4 ring-surface-raised"
              typeAccent={
                profile.signatureType
                  ? TYPE_COLORS[profile.signatureType as PokemonType]
                  : null
              }
            />
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className="text-2xl font-bold leading-tight truncate font-heading"
                style={nameStyle}
              >
                {display}
              </h1>
              {profile.signaturePokemonName && (
                <img
                  src={spriteUrl(profile.signaturePokemonName)}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  title={profile.signaturePokemonName}
                  className="shrink-0"
                  style={{ width: 36, height: 36, imageRendering: 'pixelated', marginTop: -6, marginBottom: -6 }}
                />
              )}
              {profile.signatureType && (
                <ProfileTypeChip type={profile.signatureType as PokemonType} />
              )}
            </div>
            {profile.displayName && profile.displayName !== profile.username && (
              <div className="text-xs font-mono text-text-muted mt-0.5">@{profile.username}</div>
            )}
            {/* Coach title — small mono line under display_name; stays
                quiet so it doesn't compete with the status message below. */}
            {profile.title && (
              <div className="text-[11px] font-mono text-text-secondary mt-1 leading-tight">
                {profile.title}
              </div>
            )}
            {profile.statusMessage && (
              // Status one-liner — Space Grotesk for the warmer, more
              // conversational read; sits visually above the longer bio.
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
            {isSelf && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-border-default bg-surface-overlay/40 hover:bg-surface-overlay hover:border-neon/40 hover:text-neon text-[10px] font-mono uppercase tracking-wider text-text-muted transition-colors"
                title="Edit your profile"
              >
                <Pencil size={10} />
                Edit
              </button>
            )}
            {seasonNumber != null && (
              <div className="text-right">
                <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  {formatTenure(seasonNumber)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings panel — modal overlay, only rendered for the profile owner. */}
      {isSelf && (
        <ProfileSettingsPanel
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          profile={profile}
          onSaved={refetch}
        />
      )}

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
      <h2 className="text-[11px] font-heading font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">
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

/** Larger version of the popover TypeChip for the profile header — same
 *  TYPE_COLORS palette, bigger touch target. */
function ProfileTypeChip({ type }: { type: PokemonType }) {
  const color = TYPE_COLORS[type];
  const label = TYPE_LABELS[type];
  if (!color || !label) return null;
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider shrink-0"
      style={{
        backgroundColor: `${color}22`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}80`,
      }}
      title={`Signature type: ${type}`}
    >
      {label}
    </span>
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
