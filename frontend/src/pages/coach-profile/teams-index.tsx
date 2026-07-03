/**
 * /coach/:username/teams — directory of every team-tenure (current + past)
 * for a coach. Sortable by season, league, finish position. Active rows
 * link to the live team URL `/league/:id/teams/:id`; past (archived)
 * tenures route into the archive at `/archive/:seasonId/:leagueId/:teamId`
 * so we don't hit a dead/redirected live page.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ChevronRight, Crown, Medal } from 'lucide-react';
import { api, type ApiPublicProfile, type ApiLeague } from '@/lib/api';
import { TeamLogo } from '@/components/team-logo';
import { EmptyState } from '@/components/empty-state';
import { PageLoadingSpinner } from '@/components/skeletons';
import { cn } from '@/lib/utils';

type SortKey = 'season' | 'league' | 'team' | 'finish';
type SortDir = 'asc' | 'desc';

interface Tenure {
  teamId: string;
  leagueId: string;
  /** DB id of the season — present for past (archived) rows so we can
   *  deep-link the archive view. Null for active rows. */
  seasonId: number | null;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  logoPath: string | null;
  seasonNumber: number;
  finish: { position: number; label: string } | null;
  /** True for active-season tenures. False for archived rows. */
  active: boolean;
}

export function CoachTeamsIndexPage() {
  const { username = '' } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<ApiPublicProfile | null>(null);
  const [leagues, setLeagues] = useState<ApiLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('season');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Pull leagues alongside the profile so we can resolve current-team season
  // numbers when the backend doesn't echo them on the profile payload (older
  // deploys). Read defensively — leagues fetch failure shouldn't blank the
  // page; the table just falls back to the leagueId as the league label.
  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    Promise.all([
      api.getPublicProfile(username).catch(() => null),
      api.getLeagues().catch(() => [] as ApiLeague[]),
    ]).then(([prof, lgs]) => {
      if (cancelled) return;
      if (!prof) { setNotFound(true); setLoading(false); return; }
      setProfile(prof);
      setLeagues(lgs);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [username]);

  // Resolve a season number for current-season tenures from the leagues
  // endpoint when the profile payload doesn't carry one. Memoize because
  // the compute is cheap but runs on every sort toggle otherwise.
  const tenures = useMemo<Tenure[]>(() => {
    if (!profile) return [];
    const leagueSeason = new Map<string, number | null>();
    for (const lg of leagues) {
      leagueSeason.set(lg.id, lg.season?.seasonNumber ?? null);
    }
    const current: Tenure[] = profile.currentTeams.map(t => ({
      teamId: t.teamId,
      leagueId: t.leagueId,
      seasonId: null,
      teamName: t.teamName,
      teamAbbrev: t.teamAbbrev,
      teamColor: t.teamColor,
      logoPath: t.logoPath,
      seasonNumber: t.seasonNumber ?? leagueSeason.get(t.leagueId) ?? 0,
      finish: null,
      active: true,
    }));
    const past: Tenure[] = (profile.pastTeams ?? []).map(t => ({
      teamId: t.teamId,
      leagueId: t.leagueId,
      seasonId: t.seasonId,
      teamName: t.teamName,
      teamAbbrev: t.teamAbbrev,
      teamColor: t.teamColor,
      logoPath: t.logoPath,
      seasonNumber: t.seasonNumber,
      finish: t.finish,
      active: false,
    }));
    return [...current, ...past];
  }, [profile, leagues]);

  const sorted = useMemo(() => {
    const arr = [...tenures];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'season':
          cmp = a.seasonNumber - b.seasonNumber;
          break;
        case 'league':
          cmp = a.leagueId.localeCompare(b.leagueId);
          break;
        case 'team':
          cmp = a.teamName.localeCompare(b.teamName);
          break;
        case 'finish': {
          // Champion (1) sorts first ascending; null (no finish) sorts last
          // regardless of direction so unranked rows don't intrude into the
          // medal section.
          const ap = a.finish?.position ?? Infinity;
          const bp = b.finish?.position ?? Infinity;
          cmp = ap - bp;
          break;
        }
      }
      // Secondary sort by season desc keeps recent-first tie-breaks readable.
      if (cmp === 0) cmp = b.seasonNumber - a.seasonNumber;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [tenures, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'season' || key === 'finish' ? 'desc' : 'asc');
    }
  }

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

  const display = profile.displayName?.trim() || profile.username;

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-8">
      {/* Back nav */}
      <Link
        to={`/coach/${encodeURIComponent(profile.username)}`}
        viewTransition
        className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-neon transition-colors uppercase tracking-widest"
      >
        <ArrowLeft size={11} /> {display}
      </Link>

      {/* Title strip */}
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-mono uppercase tracking-wider">
          <span className="text-neon">{display}</span>{' '}
          <span className="text-text-primary">Teams</span>
        </h1>
        <span className="text-[10px] font-mono text-text-muted">
          {tenures.length} tenure{tenures.length === 1 ? '' : 's'}
        </span>
      </div>

      {tenures.length === 0 ? (
        <EmptyState
          variant="quiet"
          title="No team tenures yet."
          subtitle="Once this coach is drafted (or backfilled) their teams will land here."
          spriteSize="md"
          padding="md"
        />
      ) : (
        <div className="rounded-xl border border-border-default bg-surface-raised overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[60px_1fr_120px_140px_28px] items-center gap-3 px-3 py-2 border-b border-border-subtle text-[10px] font-mono uppercase tracking-wider text-text-muted">
            <SortHeader label="Season" k="season" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="Team" k="team" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="League" k="league" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortHeader label="Finish" k="finish" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <span aria-hidden />
          </div>

          {/* Rows */}
          <ul>
            {sorted.map(t => (
              <li key={`${t.leagueId}-${t.seasonNumber}`}>
                <Link
                  to={
                    t.active || t.seasonId == null
                      ? `/league/${t.leagueId}/teams/${t.teamId}`
                      : `/archive/${t.seasonId}/${t.leagueId}/${t.teamId}`
                  }
                  viewTransition
                  className="grid grid-cols-[60px_1fr_120px_140px_28px] items-center gap-3 px-3 py-2 border-b border-border-subtle last:border-b-0 hover:bg-surface-overlay/40 transition-colors group"
                >
                  <span className="text-xs font-mono tabular-nums text-text-secondary">
                    S{t.seasonNumber || '—'}
                  </span>
                  <span className="flex items-center gap-2 min-w-0">
                    <TeamLogo
                      abbrev={t.teamAbbrev}
                      color={t.teamColor}
                      logoPath={t.logoPath}
                      size="sm"
                      className="shrink-0"
                    />
                    <span
                      className="text-sm font-medium truncate"
                      style={{ color: t.teamColor }}
                    >
                      {t.teamName}
                    </span>
                    <span className="text-[9px] font-mono text-text-muted shrink-0">
                      {t.teamAbbrev}
                    </span>
                    {t.active && (
                      <span className="inline-flex items-center px-1 py-px rounded text-[8px] font-mono font-bold uppercase tracking-wider shrink-0 bg-neon/15 text-neon ring-1 ring-neon/30">
                        Active
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono uppercase text-text-muted">
                    {t.leagueId}
                  </span>
                  <span>
                    {t.finish ? (
                      <FinishCell finish={t.finish} />
                    ) : (
                      <span className="text-[10px] font-mono text-text-muted/70">
                        {t.active ? 'In progress' : '—'}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-text-muted/40 group-hover:text-neon group-hover:translate-x-0.5 transition-all"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label, k, sortKey, sortDir, onSort,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={cn(
        'inline-flex items-center gap-1 hover:text-text-primary transition-colors text-left',
        active && 'text-text-primary',
      )}
    >
      {label}
      {active && (sortDir === 'desc' ? <ArrowDown size={9} /> : <ArrowUp size={9} />)}
    </button>
  );
}

function FinishCell({
  finish,
}: {
  finish: { position: number; label: string };
}) {
  if (finish.position === 1) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
        <Crown size={10} />
        {finish.label}
      </span>
    );
  }
  if (finish.position === 2) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-300">
        <Medal size={10} />
        {finish.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-text-secondary">
      {finish.label}
    </span>
  );
}
