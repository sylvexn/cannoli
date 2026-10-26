import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { preloadSprites } from '@/components/pokemon-sprite';
import { useMatchupState } from './use-matchup-state';
import { TeamPicker } from './team-picker';
import { RosterStrip } from './roster-strip';
import { OpponentGrid } from './opponent-grid';
import { OverviewTab } from './tabs/overview-tab';
import { TypeChartTab } from './tabs/typechart-tab';
import { StatsTab } from './tabs/stats-tab';
import { SpeedTab } from './tabs/speed-tab';
import { MovesTab } from './tabs/moves-tab';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api, type ApiTeam } from '@/lib/api';
import { trackEvent } from '@/lib/analytics';
import { rosterFromApi } from '@/lib/roster-from-api';
import { useDraftCenterTeams } from '@/lib/draft-center/store';
import { useAllLeagues } from '@/lib/draft-center/use-all-leagues';
import { resolveRuleset } from '@/lib/draft-center/ruleset';
import { teamToRoster } from '@/lib/draft-center/roster';
import type { League } from '@/lib/types';
import { sortLeaguesByActivity } from './league-order';
import {
  LayoutDashboard, Grid3X3, BarChart3, Gauge, Swords, RotateCcw,
} from 'lucide-react';
import type { MatchupTab } from './use-matchup-state';

export function MatchupCenterPage() {
  const { state, dispatch, activeTeamA, activeTeamB } = useMatchupState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const speedInitRef = useRef(false);
  const { user } = useAuth();
  const { leagues } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const initRef = useRef(false);
  /** Bumped by Reset to re-run the default-team resolution. */
  const [resetKey, setResetKey] = useState(0);

  /** League + teams roster of the user's pre-populated "your team" — drives
   *  the opponent gem grid. Cleared/replaced when team A changes. */
  const [opponentContext, setOpponentContext] = useState<{ league: League; teams: ApiTeam[] } | null>(null);
  /** True once we've finished the initial probe and confirmed the user has no
   *  managed team in any league — turns the empty state into a "browse" CTA. */
  const [noManagedTeam, setNoManagedTeam] = useState(false);

  // Auto-populate team A with the user's team (and B from deep-link).
  // Only runs once per mount — manual changes via TeamPicker won't be overridden.
  useEffect(() => {
    if (initRef.current) return;
    if (leagues.length === 0) return;
    initRef.current = true;

    const paramLeagueId = searchParams.get('leagueId');
    const paramTeamA = searchParams.get('teamA');
    const paramTeamB = searchParams.get('teamB');

    // A selection restored from the session (Back navigation) wins over the default.
    const deepLinked = !!(paramLeagueId && (paramTeamA || paramTeamB)) || !!searchParams.get('dc');
    if (stateRef.current.teamA.length > 0 && !deepLinked) return;

    (async () => {
      // Resolve team A
      let teamAResolved = false;
      if (paramLeagueId && paramTeamA) {
        const league = leagues.find(l => l.id === paramLeagueId);
        if (league) {
          const teams = await api.getTeams(league.id).catch(() => []);
          const team = teams.find(t => t.id === paramTeamA);
          if (team) {
            dispatch({
              type: 'SET_TEAM_A',
              roster: rosterFromApi(team.roster),
              source: { type: 'league', leagueId: league.id, teamId: team.id, label: `${team.teamName} (${league.name.replace(' League', '')})` },
            });
            setOpponentContext({ league, teams });
            teamAResolved = true;
          }
        }
      }
      // Fallback: find user's own team in any league, prioritising the
      // most-active league (drafting > regular > playoffs > predraft > offseason).
      if (!teamAResolved && user && !searchParams.get('dc')) {
        const sortedLeagues = sortLeaguesByActivity(leagues);
        for (const league of sortedLeagues) {
          const teams = await api.getTeams(league.id).catch(() => []);
          const team = teams.find(t => t.userId != null && String(t.userId) === user.id);
          if (team) {
            dispatch({
              type: 'SET_TEAM_A',
              roster: rosterFromApi(team.roster),
              source: { type: 'league', leagueId: league.id, teamId: team.id, label: `${team.teamName} (${league.name.replace(' League', '')})` },
            });
            setOpponentContext({ league, teams });
            teamAResolved = true;
            break;
          }
        }
      }

      if (!teamAResolved && !searchParams.get('dc')) {
        setNoManagedTeam(true);
      }

      // Resolve team B from deep-link
      if (paramLeagueId && paramTeamB) {
        const league = leagues.find(l => l.id === paramLeagueId);
        if (league) {
          const teams = await api.getTeams(league.id).catch(() => []);
          const team = teams.find(t => t.id === paramTeamB);
          if (team) {
            dispatch({
              type: 'SET_TEAM_B',
              roster: rosterFromApi(team.roster),
              source: { type: 'league', leagueId: league.id, teamId: team.id, label: `${team.teamName} (${league.name.replace(' League', '')})` },
            });
          }
        }
      }
    })();
  }, [leagues, searchParams, user, dispatch, resetKey]);

  // Deep link from the Draft Center editor: ?dc=<team id> loads that team as side A.
  const paramDc = searchParams.get('dc');
  const { teams: dcTeams, loading: dcLoading } = useDraftCenterTeams();
  const { leagues: allLeagues, loading: allLeaguesLoading } = useAllLeagues();
  const dcLoadedRef = useRef(false);
  useEffect(() => {
    if (!paramDc || dcLoadedRef.current || dcLoading || allLeaguesLoading) return;
    dcLoadedRef.current = true;
    const dc = dcTeams.find(t => t.id === paramDc);
    if (!dc) return;
    dispatch({
      type: 'SET_TEAM_A',
      roster: teamToRoster(dc.roster, resolveRuleset(dc.leagueId, allLeagues)),
      source: { type: 'draft-center', teamId: dc.id, label: `${dc.name} (Draft Center)` },
    });
    setNoManagedTeam(false);
  }, [paramDc, dcTeams, dcLoading, allLeagues, allLeaguesLoading, dispatch]);

  /** Refresh the opponent gem-grid context whenever the user manually changes
   *  team A via the picker. We re-fetch the league's teams from the matching
   *  league. Skipped for custom teams (no league context). */
  useEffect(() => {
    const src = state.teamASource;
    if (!src || src.type !== 'league' || !src.leagueId) {
      setOpponentContext(null);
      return;
    }
    if (opponentContext?.league.id === src.leagueId) return;
    const league = leagues.find(l => l.id === src.leagueId);
    if (!league) return;
    let cancelled = false;
    api.getTeams(league.id).then(teams => {
      if (!cancelled) setOpponentContext({ league, teams });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [state.teamASource, leagues, opponentContext?.league.id]);

  function selectOpponent(team: ApiTeam) {
    if (!opponentContext) return;
    dispatch({
      type: 'SET_TEAM_B',
      roster: rosterFromApi(team.roster),
      source: {
        type: 'league',
        leagueId: opponentContext.league.id,
        teamId: team.id,
        label: `${team.teamName} (${opponentContext.league.name.replace(' League', '')})`,
      },
    });
    trackEvent('matchup.compare');
  }

  // Preload sprites for both teams
  useEffect(() => {
    const names = [...state.teamA, ...state.teamB].map(p => p.name);
    if (names.length > 0) preloadSprites(names);
  }, [state.teamA, state.teamB]);

  // Init speed slots with random Pokemon when both teams are loaded (first time only)
  useEffect(() => {
    if (!speedInitRef.current && state.teamA.length > 0 && state.teamB.length > 0) {
      speedInitRef.current = true;
      dispatch({ type: 'INIT_SPEED_SLOTS', teamA: state.teamA, teamB: state.teamB });
    }
  }, [state.teamA, state.teamB, dispatch]);

  function resetAll() {
    dispatch({ type: 'RESET' });
    setOpponentContext(null);
    setNoManagedTeam(false);
    speedInitRef.current = false;
    // Drop deep-link params so the default (your own team) resolves again.
    setSearchParams({}, { replace: true });
    initRef.current = false;
    setResetKey(k => k + 1);
  }

  const hasSubTeam = state.subTeamA.size > 0 || state.subTeamB.size > 0;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header + Team Pickers */}
      {/* flex-wrap + basis floor: at high browser zoom (effectively narrow
          viewports) the pickers drop below the title instead of crushing or
          overflowing the row. */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="shrink-0">
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-neon">Matchup</span>{' '}
            <span className="text-text-primary">Center</span>
          </h1>
        </div>
        <div className="flex-1 basis-80 min-w-0 grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <TeamPicker
            source={state.teamASource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_A', roster, source })}
            side="a"
          />
          <span className="text-xs font-heading font-bold text-text-muted uppercase tracking-widest">vs</span>
          <TeamPicker
            source={state.teamBSource}
            onSelect={(roster, source) => {
              dispatch({ type: 'SET_TEAM_B', roster, source });
              trackEvent('matchup.compare');
            }}
            side="b"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={resetAll}
          disabled={!state.teamASource && !state.teamBSource}
          title="Clear both teams back to your default"
        >
          <RotateCcw size={13} /> Reset
        </Button>
      </div>

      {/* Roster Strip — always visible */}
      <div className="flex gap-1.5 items-stretch overflow-x-auto">
        {state.teamA.length === 0 && noManagedTeam ? (
          <NoManagedTeamPanel />
        ) : (
          <RosterStrip
            team={state.teamA}
            subTeam={state.subTeamA}
            onToggle={name => dispatch({ type: 'TOGGLE_SUB_A', name })}
            side="a"
            label={state.teamASource?.label}
          />
        )}
        {/* Reset sub-teams button */}
        <div className="flex items-center">
          <button
            onClick={() => dispatch({ type: 'RESET_SUB_TEAMS' })}
            disabled={!hasSubTeam}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Reset selected Pokemon"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        {state.teamB.length === 0 && opponentContext ? (
          <OpponentGrid
            league={opponentContext.league}
            teams={opponentContext.teams}
            excludeTeamId={state.teamASource?.type === 'league' ? state.teamASource.teamId : undefined}
            onSelect={selectOpponent}
          />
        ) : (
          <RosterStrip
            team={state.teamB}
            subTeam={state.subTeamB}
            onToggle={name => dispatch({ type: 'TOGGLE_SUB_B', name })}
            side="b"
            label={state.teamBSource?.label}
          />
        )}
      </div>

      {/* Tabbed Analysis */}
      <Tabs
        value={state.activeTab}
        onValueChange={(v) => dispatch({ type: 'SET_TAB', tab: v as MatchupTab })}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList variant="line">
          <TabsTrigger value="overview">
            <LayoutDashboard size={14} />
            Overview
          </TabsTrigger>
          <TabsTrigger value="typechart">
            <Grid3X3 size={14} />
            Type Chart
          </TabsTrigger>
          <TabsTrigger value="stats">
            <BarChart3 size={14} />
            Stats
          </TabsTrigger>
          <TabsTrigger value="speed">
            <Gauge size={14} />
            Speed
          </TabsTrigger>
          <TabsTrigger value="moves">
            <Swords size={14} />
            Moves
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto mt-3">
          <TabsContent value="overview">
            <OverviewTab teamA={activeTeamA} teamB={activeTeamB} />
          </TabsContent>
          <TabsContent value="typechart">
            <TypeChartTab teamA={activeTeamA} teamB={activeTeamB} />
          </TabsContent>
          <TabsContent value="stats">
            <StatsTab teamA={activeTeamA} teamB={activeTeamB} />
          </TabsContent>
          <TabsContent value="speed">
            <SpeedTab
              teamA={activeTeamA}
              teamB={activeTeamB}
              slots={state.speedCalcSlots}
              onAddSlot={() => dispatch({ type: 'ADD_SPEED_SLOT' })}
              onRemoveSlot={id => dispatch({ type: 'REMOVE_SPEED_SLOT', id })}
              onUpdateSlot={(id, updates) => dispatch({ type: 'UPDATE_SPEED_SLOT', id, updates })}
            />
          </TabsContent>
          <TabsContent value="moves" className="h-full min-h-0 flex flex-col">
            <MovesTab teamA={activeTeamA} teamB={activeTeamB} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** Side-A panel shown when the viewer doesn't manage any team. Tells them
 *  what to do next (browse leagues / pick a team manually) instead of just
 *  saying "Select your team above". */
function NoManagedTeamPanel() {
  return (
    <div className="flex-1 rounded-lg border border-dashed border-[#3b82f6]/20 bg-[#3b82f6]/5 px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-[#3b82f6]">No team yet</div>
        <p className="text-[11px] text-text-muted leading-snug">
          Pick any league team in the dropdown above, or browse leagues to find one to follow.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        render={<Link to="/" />}
      >
        Browse leagues
      </Button>
    </div>
  );
}
