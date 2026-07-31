import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { TeamLogo } from '@/components/team-logo';
import { useAuth } from '@/lib/auth-context';
import { useAppData } from '@/lib/app-data-context';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { TIER_LIST } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { api } from '@/lib/api';
import {
  Globe, Trophy, LayoutDashboard, Calendar, BarChart3,
  ArrowLeftRight, Swords, Archive, Shield, Settings,
  Users, CalendarCog, List, ScrollText, MessageSquare,
  Trophy as TrophyIcon, Award, Bot as BotIcon,
  Film, Gauge, ListTree, Gamepad2,
} from 'lucide-react';

// Admin tab definitions (mirrored from admin/index.tsx)
// `id` is the URL slug under /admin/.
const ADMIN_TABS = [
  { id: 'users', label: 'Users', group: 'People', icon: Users },
  { id: 'teams', label: 'Teams', group: 'People', icon: Shield },
  { id: 'leagues', label: 'Leagues', group: 'League', icon: Globe },
  { id: 'season', label: 'Season', group: 'League', icon: CalendarCog },
  { id: 'matches', label: 'Matches', group: 'League', icon: TrophyIcon },
  { id: 'trades', label: 'Trades', group: 'League', icon: ArrowLeftRight },
  { id: 'tiers', label: 'Tier List', group: 'Config', icon: List },
  { id: 'moves', label: 'Move Categories', group: 'Config', icon: Swords },
  { id: 'pins', label: 'Pins', group: 'Config', icon: Award },
  { id: 'settings', label: 'Site Settings', group: 'Config', icon: Settings },
  { id: 'activity', label: 'Activity Log', group: 'System', icon: ScrollText },
  { id: 'bot', label: 'PS Bot', group: 'System', icon: BotIcon },
  { id: 'feedback', label: 'Feedback', group: 'System', icon: MessageSquare },
];

// League page definitions
const LEAGUE_PAGES = [
  { path: '', label: 'Standings', icon: Trophy },
  { path: '/draft', label: 'Draft Board', icon: LayoutDashboard },
  { path: '/schedule', label: 'Schedule', icon: Calendar },
  { path: '/stats', label: 'Pokemon Stats', icon: BarChart3 },
  // /market is a redirect-only shell — link the real default tab.
  { path: '/market/trades', label: 'Market', icon: ArrowLeftRight },
];

const GLOBAL_PAGES = [
  { path: '/', label: 'League Overview', icon: Globe },
  { path: '/matchup', label: 'Matchup Center', icon: Swords },
  { path: '/showdown', label: 'Showdown', icon: Gamepad2 },
  { path: '/replays', label: 'Replays', icon: Film },
  { path: '/archive', label: 'Season Archive', icon: Archive },
  { path: '/tiers', label: 'Tier List', icon: ListTree },
  { path: '/speed-tiers', label: 'Speed Tiers', icon: Gauge },
  { path: '/badges', label: 'Badges', icon: Award },
  { path: '/rules', label: 'Rules', icon: ScrollText },
  { path: '/settings', label: 'Settings', icon: Settings },
];

// Prefix filters
type FilterMode = 'all' | 'pokemon' | 'teams' | 'pages' | 'admin';

function getFilterMode(query: string): { mode: FilterMode; cleanQuery: string } {
  if (query.startsWith('>')) return { mode: 'pokemon', cleanQuery: query.slice(1).trim() };
  if (query.startsWith('@')) return { mode: 'teams', cleanQuery: query.slice(1).trim() };
  if (query.startsWith('/')) return { mode: 'pages', cleanQuery: query.slice(1).trim() };
  if (query.startsWith('!')) return { mode: 'admin', cleanQuery: query.slice(1).trim() };
  return { mode: 'all', cleanQuery: query };
}

// Pokemon search (limit results for performance)
const MAX_POKEMON_RESULTS = 12;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TeamEntry {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  playerId: string;
  playerName: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  logoPath: string | null;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { leagues } = useAppData();
  const { openSideCard } = usePokemonSideCard();
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const fetchedRef = useRef(false);

  // Fetch teams once when palette first opens
  useEffect(() => {
    if (!open || fetchedRef.current || leagues.length === 0) return;
    fetchedRef.current = true;
    Promise.all(
      leagues.map(l =>
        api.getTeams(l.id).then(apiTeams => ({ league: l, apiTeams }))
      )
    ).then(results => {
      const entries: TeamEntry[] = [];
      for (const { league, apiTeams } of results) {
        for (const t of apiTeams) {
          entries.push({
            leagueId: league.id,
            leagueName: league.name.replace(' League', ''),
            leagueColor: league.color,
            playerId: t.id,
            playerName: t.name,
            teamName: t.teamName,
            teamAbbrev: t.teamAbbrev,
            teamColor: t.teamColor,
            logoPath: t.logoPath ?? null,
          });
        }
      }
      setTeams(entries);
    });
  }, [open, leagues]);

  // Reset query when closing
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const { mode, cleanQuery } = useMemo(() => getFilterMode(query), [query]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Navigate helper
  const go = useCallback((path: string) => {
    close();
    navigate(path);
  }, [close, navigate]);

  // Pokemon results
  const pokemonResults = useMemo(() => {
    if (mode !== 'all' && mode !== 'pokemon') return [];
    const q = cleanQuery.toLowerCase();
    if (!q && mode !== 'pokemon') return [];

    const results: typeof TIER_LIST = [];
    for (const entry of TIER_LIST) {
      if (results.length >= MAX_POKEMON_RESULTS) break;
      const nameMatch = entry.name.toLowerCase().includes(q);
      if (nameMatch) {
        results.push(entry);
        continue;
      }
      // Search by type
      const pokeData = getPokemonData(entry.name);
      if (pokeData?.types.some(t => t.toLowerCase().includes(q))) {
        results.push(entry);
      }
    }
    return results;
  }, [mode, cleanQuery]);

  // Team/player results
  const teamResults = useMemo(() => {
    if (mode !== 'all' && mode !== 'teams') return [];
    const q = cleanQuery.toLowerCase();
    if (!q && mode !== 'teams') return [];

    return teams.filter(t => {
      if (!q && mode === 'teams') return true;
      return t.teamName.toLowerCase().includes(q) ||
        t.teamAbbrev.toLowerCase().includes(q) ||
        t.playerName.toLowerCase().includes(q);
    });
  }, [mode, cleanQuery, teams]);

  // Page results
  const pageResults = useMemo(() => {
    if (mode !== 'all' && mode !== 'pages') return [];
    const q = cleanQuery.toLowerCase();

    const results: { path: string; label: string; icon: typeof Globe; leagueName?: string; leagueColor?: string }[] = [];

    // Global pages
    for (const page of GLOBAL_PAGES) {
      if (!q || page.label.toLowerCase().includes(q)) {
        results.push(page);
      }
    }

    // League-scoped pages
    for (const league of leagues) {
      const leagueName = league.name.replace(' League', '');
      for (const page of LEAGUE_PAGES) {
        const searchText = `${page.label} ${leagueName}`.toLowerCase();
        if (!q || searchText.includes(q)) {
          results.push({
            path: `/league/${league.id}${page.path}`,
            label: `${page.label}`,
            icon: page.icon,
            leagueName,
            leagueColor: league.color,
          });
        }
      }
    }

    return results;
  }, [mode, cleanQuery, leagues]);

  // League results
  const leagueResults = useMemo(() => {
    if (mode !== 'all' && mode !== 'pages') return [];
    const q = cleanQuery.toLowerCase();
    if (!q) return [];

    return leagues.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.name.replace(' League', '').toLowerCase().includes(q)
    );
  }, [mode, cleanQuery, leagues]);

  // Admin results
  const adminResults = useMemo(() => {
    if (!isAdmin) return [];
    if (mode !== 'all' && mode !== 'admin') return [];
    const q = cleanQuery.toLowerCase();
    if (!q && mode !== 'admin') return [];

    return ADMIN_TABS.filter(tab =>
      !q || tab.label.toLowerCase().includes(q) || tab.group.toLowerCase().includes(q)
    );
  }, [isAdmin, mode, cleanQuery]);

  const hasResults = pokemonResults.length > 0 || teamResults.length > 0 ||
    pageResults.length > 0 || leagueResults.length > 0 || adminResults.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false} className="font-mono">
        <CommandInput
          placeholder={
            mode === 'pokemon' ? 'Search Pokemon by name or type…' :
            mode === 'teams' ? 'Search teams or players…' :
            mode === 'pages' ? 'Search pages…' :
            mode === 'admin' ? 'Search admin tabs…' :
            'Search Pokemon, teams, pages…'
          }
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-80">
          {!hasResults && cleanQuery && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}

          {/* Hint when empty */}
          {!cleanQuery && mode === 'all' && (
            <div className="px-4 py-3 text-xs text-text-muted space-y-1">
              <div className="flex items-center gap-3">
                <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay text-[10px] font-mono text-text-secondary">&gt;</kbd>
                <span>Pokemon</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay text-[10px] font-mono text-text-secondary">@</kbd>
                <span>Teams</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay text-[10px] font-mono text-text-secondary">/</kbd>
                <span>Pages</span>
                {isAdmin && (
                  <>
                    <kbd className="px-1.5 py-0.5 rounded bg-surface-overlay text-[10px] font-mono text-text-secondary">!</kbd>
                    <span>Admin</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Pokemon */}
          {pokemonResults.length > 0 && (
            <>
              <CommandGroup heading="Pokemon">
                {pokemonResults.map(entry => {
                  const pokeData = getPokemonData(entry.name);
                  return (
                    <CommandItem
                      key={entry.name}
                      value={`pokemon:${entry.name}`}
                      onSelect={() => {
                        close();
                        openSideCard(entry.name);
                      }}
                      className="flex items-center gap-2.5 py-1.5"
                    >
                      <PokemonSprite name={entry.name} size="xs" />
                      <span className="font-medium text-text-primary">{entry.name}</span>
                      {/* TODO: TIER_LIST defaults to natdexplus — no single format is
                          correct here since the palette is cross-league. Consider
                          omitting the tier or showing "varies" if multi-format diverges. */}
                      <TierBadge points={entry.tier} />
                      {pokeData?.types && <TypeChip types={pokeData.types} size="sm" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {(teamResults.length > 0 || pageResults.length > 0 || adminResults.length > 0) && (
                <CommandSeparator />
              )}
            </>
          )}

          {/* Leagues */}
          {leagueResults.length > 0 && (
            <>
              <CommandGroup heading="Leagues">
                {leagueResults.map(league => (
                  <CommandItem
                    key={`league:${league.id}`}
                    value={`league:${league.id}`}
                    onSelect={() => go(`/league/${league.id}`)}
                    className="flex items-center gap-2.5"
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: league.color }}
                    />
                    <span className="font-medium text-text-primary">{league.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Teams / Players */}
          {teamResults.length > 0 && (
            <>
              <CommandGroup heading="Teams">
                {teamResults.map(t => (
                  <CommandItem
                    key={`team:${t.leagueId}:${t.playerId}`}
                    value={`team:${t.leagueId}:${t.playerId}`}
                    onSelect={() => go(`/league/${t.leagueId}/teams/${t.playerId}`)}
                    className="flex items-center gap-2.5"
                  >
                    <TeamLogo abbrev={t.teamAbbrev} color={t.teamColor} size="sm" logoPath={t.logoPath} />
                    <span className="min-w-0 truncate font-medium text-text-primary">{t.teamName}</span>
                    <span className="min-w-0 truncate text-xs text-text-muted">{t.playerName}</span>
                    <span
                      className="ml-auto shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ color: t.leagueColor, backgroundColor: `${t.leagueColor}15` }}
                    >
                      {t.leagueName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {(pageResults.length > 0 || adminResults.length > 0) && <CommandSeparator />}
            </>
          )}

          {/* Pages */}
          {pageResults.length > 0 && (
            <>
              <CommandGroup heading="Pages">
                {pageResults.map(page => {
                  const Icon = page.icon;
                  return (
                    <CommandItem
                      key={`page:${page.path}`}
                      value={`page:${page.path}`}
                      onSelect={() => go(page.path)}
                      className="flex items-center gap-2.5"
                    >
                      <Icon size={14} className="text-text-muted shrink-0" />
                      <span className="min-w-0 truncate font-medium text-text-primary">{page.label}</span>
                      {page.leagueName && (
                        <span
                          className="ml-auto shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{ color: page.leagueColor, backgroundColor: `${page.leagueColor}15` }}
                        >
                          {page.leagueName}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {adminResults.length > 0 && <CommandSeparator />}
            </>
          )}

          {/* Admin */}
          {adminResults.length > 0 && (
            <CommandGroup heading="Admin">
              {adminResults.map(tab => {
                const Icon = tab.icon;
                return (
                  <CommandItem
                    key={`admin:${tab.id}`}
                    value={`admin:${tab.id}`}
                    onSelect={() => go(`/admin/${tab.id}`)}
                    className="flex items-center gap-2.5"
                  >
                    <Icon size={14} className="text-text-muted shrink-0" />
                    <span className="font-medium text-text-primary">{tab.label}</span>
                    <span className="ml-auto text-[10px] text-text-muted">{tab.group}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
