import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { preloadSprites } from '@/components/pokemon-sprite';
import { useMatchupState } from './use-matchup-state';
import { TeamPicker } from './team-picker';
import { RosterStrip } from './roster-strip';
import { OverviewTab } from './tabs/overview-tab';
import { TypeChartTab } from './tabs/typechart-tab';
import { StatsTab } from './tabs/stats-tab';
import { SpeedTab } from './tabs/speed-tab';
import { MovesTab } from './tabs/moves-tab';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { RosterPokemon } from '@/lib/types';
import type { PokemonType } from '@/lib/pokemon';
import {
  LayoutDashboard, Grid3X3, BarChart3, Gauge, Swords, RotateCcw,
} from 'lucide-react';
import type { MatchupTab } from './use-matchup-state';

export function MatchupCenterPage() {
  const { state, dispatch, activeTeamA, activeTeamB } = useMatchupState();
  const speedInitRef = useRef(false);
  const { user } = useAuth();
  const { leagues } = useAppData();
  const [searchParams] = useSearchParams();
  const initRef = useRef(false);

  // Auto-populate team A with the user's team (and B from deep-link).
  // Only runs once per mount — manual changes via TeamPicker won't be overridden.
  useEffect(() => {
    if (initRef.current) return;
    if (leagues.length === 0) return;
    initRef.current = true;

    const paramLeagueId = searchParams.get('leagueId');
    const paramTeamA = searchParams.get('teamA');
    const paramTeamB = searchParams.get('teamB');

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
            teamAResolved = true;
          }
        }
      }
      // Fallback: find user's own team in any league
      if (!teamAResolved && user) {
        for (const league of leagues) {
          const teams = await api.getTeams(league.id).catch(() => []);
          const team = teams.find(t => t.userId != null && String(t.userId) === user.id);
          if (team) {
            dispatch({
              type: 'SET_TEAM_A',
              roster: rosterFromApi(team.roster),
              source: { type: 'league', leagueId: league.id, teamId: team.id, label: `${team.teamName} (${league.name.replace(' League', '')})` },
            });
            break;
          }
        }
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
  }, [leagues, searchParams, user, dispatch]);

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

  const hasSubTeam = state.subTeamA.size > 0 || state.subTeamB.size > 0;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header + Team Pickers */}
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
            <span className="text-neon">Matchup</span>{' '}
            <span className="text-text-primary">Center</span>
          </h1>
        </div>
        <div className="flex-1 grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <TeamPicker
            source={state.teamASource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_A', roster, source })}
            side="a"
          />
          <span className="text-xs font-heading font-bold text-text-muted uppercase tracking-widest">vs</span>
          <TeamPicker
            source={state.teamBSource}
            onSelect={(roster, source) => dispatch({ type: 'SET_TEAM_B', roster, source })}
            side="b"
          />
        </div>
      </div>

      {/* Roster Strip — always visible */}
      <div className="flex gap-1.5 items-stretch">
        <RosterStrip
          team={state.teamA}
          subTeam={state.subTeamA}
          onToggle={name => dispatch({ type: 'TOGGLE_SUB_A', name })}
          side="a"
          label={state.teamASource?.label}
        />
        {/* Reset sub-teams button */}
        <div className="flex items-center">
          <button
            onClick={() => dispatch({ type: 'RESET_SUB_TEAMS' })}
            disabled={!hasSubTeam}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-20 disabled:cursor-default"
            title="Reset selected 6"
          >
            <RotateCcw size={14} />
          </button>
        </div>
        <RosterStrip
          team={state.teamB}
          subTeam={state.subTeamB}
          onToggle={name => dispatch({ type: 'TOGGLE_SUB_B', name })}
          side="b"
          label={state.teamBSource?.label}
        />
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
          <TabsContent value="moves">
            <MovesTab teamA={activeTeamA} teamB={activeTeamB} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function rosterFromApi(roster: { name: string; types: string[]; tier: number; isTeraCaptain: boolean; teraTypes?: string[]; stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } | null; abilities: string[]; seasonStats: { kills: number; deaths: number; gp: number }; isShiny?: boolean }[]): RosterPokemon[] {
  return roster.map(r => ({
    name: r.name,
    types: r.types as PokemonType[],
    tier: r.tier,
    isTeraCaptain: r.isTeraCaptain,
    teraTypes: r.teraTypes as PokemonType[] | undefined,
    stats: r.stats || { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    abilities: r.abilities,
    seasonStats: r.seasonStats,
    isShiny: r.isShiny,
  }));
}
