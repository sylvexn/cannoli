import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TypeChip } from '@/components/type-chip';
import { TierBadge } from '@/components/tier-badge';
import { StatBar } from '@/components/stat-bar';
import { AbilityChip } from '@/components/ability-chip';
import { TeamLogo } from '@/components/team-logo';
import { TeamLink } from '@/components/team-link';
import { CoachLink } from '@/components/coach-link';
import { KDDisplay } from '@/components/kd-display';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Link } from 'react-router-dom';
import { Swords, Sparkles, X, ExternalLink, UsersRound } from 'lucide-react';
import { useLeagueOptional } from '@/lib/league-context';
import { getTierEntry, DEFAULT_FORMAT, type CostFormat } from '@/data/tier-list';
import { getPokemonData } from '@/data/pokemon-data';
import { api, type ApiGlobalOwnership } from '@/lib/api';
import type { Player } from '@/lib/types';

/** Per-league ownership entry as exposed to side-card callers. */
export interface GlobalOwnershipEntry {
  leagueId: string;
  leagueName: string;
  leagueColor: string;
  owner: Player;
}

interface PokemonSideCardProps {
  name: string | null;
  onClose: () => void;
  /** Optional: single-league owner block (legacy callsite). When present and
   *  globalOwnership is absent, the single owner block renders. */
  owner?: Player;
  /** Optional: explicit cross-league ownership list. When provided, replaces
   *  the single-owner block with a stacked per-league list. */
  globalOwnership?: GlobalOwnershipEntry[];
  /** Optional: season stats override (kills/deaths/gp) */
  seasonStats?: { kills: number; deaths: number; gp: number };
  /** Optional: tera captain info */
  teraCaptain?: { teraTypes: string[] };
  /** Optional: cost format for this league ('natdex' | 'natdexplus'). Defaults
   *  to 'natdexplus'. Pass league.costFormat when opening from a league context. */
  format?: CostFormat;
}

export function PokemonSideCard({
  name,
  onClose,
  owner,
  globalOwnership,
  seasonStats,
  teraCaptain,
  format,
}: PokemonSideCardProps) {
  const league = useLeagueOptional();
  const isOpen = !!name;

  // Auto-fetch global ownership when no explicit owner / ownership list was
  // passed AND the side card was opened from a context-only callsite (e.g.
  // tier list, free-agents, replays). Skips inside a league scope when the
  // single-owner prop is already provided.
  const [autoOwnership, setAutoOwnership] = useState<ApiGlobalOwnership[] | null>(null);
  useEffect(() => {
    if (!name) { setAutoOwnership(null); return; }
    if (owner || globalOwnership) { setAutoOwnership(null); return; }
    let cancelled = false;
    api.getPokemonGlobalOwnership(name)
      .then(rows => { if (!cancelled) setAutoOwnership(rows); })
      .catch(() => { if (!cancelled) setAutoOwnership([]); });
    return () => { cancelled = true; };
  }, [name, owner, globalOwnership]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Resolve cost format: explicit prop wins, then the in-scope league, then the
  // default. This lets callers omit the prop when inside a league route.
  const resolvedFormat = format ?? league?.costFormat ?? DEFAULT_FORMAT;
  const pokeData = name ? getPokemonData(name) : undefined;
  const tierEntry = name ? getTierEntry(name, resolvedFormat) : undefined;
  const types = pokeData?.types;
  const stats = pokeData?.stats;
  const abilities = pokeData?.abilities ?? [];
  const bst = stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null;

  // Resolve which ownership list to render. Caller-provided wins; otherwise we
  // derive from the auto-fetched global list.
  const ownershipEntries: GlobalOwnershipEntry[] = globalOwnership ?? (autoOwnership
    ? autoOwnership.map(o => ({
        leagueId: o.leagueId,
        leagueName: o.leagueName,
        leagueColor: o.leagueColor,
        owner: ownerFromApi(o),
      }))
    : []);

  return createPortal(
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]',
          'transition-opacity duration-300 ease-out',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />

      <div
        className={cn(
          'fixed top-0 right-0 bottom-0 z-50 w-[380px]',
          'bg-surface-raised border-l border-border-default shadow-card-lg',
          'flex flex-col',
          'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {name && (
          <>
            <button
              onClick={onClose}
              className="absolute top-4 right-4 z-10 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
            >
              <X size={16} />
            </button>

            {/* Hero — Pokemon name/sprite both link to the canonical detail page */}
            <div className="relative px-6 pt-6 pb-4">
              {owner && (
                <div
                  className="absolute inset-0 opacity-[0.06]"
                  style={{ background: `radial-gradient(ellipse at top right, ${owner.teamColor}, transparent 70%)` }}
                />
              )}

              <div className="relative flex items-start gap-4">
                <Link
                  to={`/pokemon/${encodeURIComponent(name)}`}
                  onClick={onClose}
                  className="flex-shrink-0 rounded-lg bg-surface-overlay/50 p-2 hover:bg-surface-overlay transition-colors"
                  title={`Open ${name} profile`}
                >
                  <PokemonSprite name={name} size="xl" />
                </Link>
                <div className="flex-1 min-w-0 pt-1">
                  <Link
                    to={`/pokemon/${encodeURIComponent(name)}`}
                    onClick={onClose}
                    className="text-lg font-heading font-bold text-text-primary leading-tight hover:text-neon transition-colors"
                  >
                    {name}
                  </Link>
                  <div className="flex items-center gap-2 mt-1.5">
                    {tierEntry && <TierBadge points={tierEntry.tier} />}
                    {types && <TypeChip types={types} size="sm" />}
                  </div>
                  {bst && (
                    <div className="text-xs text-text-muted font-mono mt-1">BST {bst}</div>
                  )}
                  {tierEntry && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-border-subtle text-text-muted font-mono">
                        Cost: {tierEntry.tier}pt
                      </Badge>
                      {tierEntry.teraCost !== tierEntry.tier && (
                        <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-pink/30 text-pink font-mono">
                          Tera: {tierEntry.teraCost}pt
                        </Badge>
                      )}
                      {tierEntry.teraBanned && (
                        <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 border-loss/30 text-loss">
                          Tera banned
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator className="bg-border-subtle" />

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {stats && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Base Stats
                  </h3>
                  <div className="space-y-1">
                    <StatBar label="HP" value={stats.hp} />
                    <StatBar label="Atk" value={stats.atk} />
                    <StatBar label="Def" value={stats.def} />
                    <StatBar label="SpA" value={stats.spa} />
                    <StatBar label="SpD" value={stats.spd} />
                    <StatBar label="Spe" value={stats.spe} />
                  </div>
                </div>
              )}

              {abilities.length > 0 && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Abilities
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {abilities.map(a => (
                      <AbilityChip key={a} name={a} />
                    ))}
                  </div>
                </div>
              )}

              {teraCaptain && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Sparkles size={12} className="text-pink" />
                    Tera Captain
                  </h3>
                  <div className="flex gap-1.5">
                    {teraCaptain.teraTypes.map(t => (
                      <TypeChip key={t} types={[t as any]} size="sm" />
                    ))}
                  </div>
                </div>
              )}

              {seasonStats && seasonStats.gp > 0 && (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Swords size={12} className="text-neon" />
                    Season Stats
                  </h3>
                  <div className="flex items-center gap-4">
                    <KDDisplay kills={seasonStats.kills} deaths={seasonStats.deaths} />
                    <span className="text-xs text-text-muted font-mono">
                      {seasonStats.gp} GP
                    </span>
                    <span className="text-xs text-text-muted font-mono">
                      {(seasonStats.kills / Math.max(1, seasonStats.gp)).toFixed(1)} KPG
                    </span>
                  </div>
                </div>
              )}

              {/* Ownership: cross-league stack when we have multiple, single
                  block when only the legacy `owner` prop was passed. */}
              {ownershipEntries.length > 0 ? (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <UsersRound size={11} className="text-neon" />
                    On The Block
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {ownershipEntries.map(({ leagueId, leagueName, leagueColor, owner: o }) => (
                      <div
                        key={`${leagueId}-${o.id}`}
                        className="flex items-center gap-2.5 p-2.5 rounded-md bg-surface-overlay/30 border border-border-subtle"
                      >
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold uppercase shrink-0 font-mono"
                          style={{ borderColor: `${leagueColor}50`, color: leagueColor }}
                        >
                          {leagueName.replace(' League', '')}
                        </Badge>
                        <TeamLink
                          team={{
                            leagueId,
                            teamId: o.id,
                            teamName: o.teamName,
                            teamAbbrev: o.teamAbbrev,
                            teamColor: o.teamColor,
                            logoPath: o.logoPath,
                            record: o.record,
                          }}
                          logoOnly
                          logoSize="md"
                        />
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/league/${leagueId}/teams/${o.id}`}
                            onClick={onClose}
                            className="text-sm font-medium text-text-primary hover:text-neon transition-colors truncate block"
                          >
                            {o.teamName}
                          </Link>
                          {o.owner ? (
                            <CoachLink
                              coach={{
                                username: o.owner.username,
                                displayName: o.owner.displayName,
                                primaryColor: o.owner.primaryColor,
                                secondaryColor: o.owner.secondaryColor,
                                tertiaryColor: o.owner.tertiaryColor,
                                avatarPath: o.owner.avatarPath,
                                role: o.owner.role,
                              }}
                              size="xs"
                              noHoverCard
                              className="text-[11px]"
                            />
                          ) : (
                            <div className="text-[11px] text-text-muted">{o.name}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : owner ? (
                <div>
                  <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider mb-2">
                    Owner
                  </h3>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-md bg-surface-overlay/30 border border-border-subtle">
                    {league ? (
                      <TeamLink
                        team={{
                          leagueId: league.id,
                          teamId: owner.id,
                          teamName: owner.teamName,
                          teamAbbrev: owner.teamAbbrev,
                          teamColor: owner.teamColor,
                          logoPath: owner.logoPath,
                          record: owner.record,
                        }}
                        logoOnly
                        logoSize="md"
                      />
                    ) : (
                      <TeamLogo abbrev={owner.teamAbbrev} color={owner.teamColor} size="md" logoPath={owner.logoPath} />
                    )}
                    <div className="min-w-0">
                      <Link
                        to={league ? `/league/${league.id}/teams/${owner.id}` : '#'}
                        onClick={onClose}
                        className="text-sm font-medium text-text-primary hover:text-neon transition-colors truncate block"
                      >
                        {owner.teamName}
                      </Link>
                      {owner.owner ? (
                        <CoachLink
                          coach={{
                            username: owner.owner.username,
                            displayName: owner.owner.displayName,
                            primaryColor: owner.owner.primaryColor,
                            secondaryColor: owner.owner.secondaryColor,
                            tertiaryColor: owner.owner.tertiaryColor,
                            avatarPath: owner.owner.avatarPath,
                            role: owner.owner.role,
                          }}
                          size="xs"
                          noHoverCard
                          className="text-[11px]"
                        />
                      ) : (
                        <div className="text-[11px] text-text-muted">{owner.name}</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : autoOwnership !== null ? (
                <div className="text-[11px] text-text-muted italic">
                  Free agent across all active leagues.
                </div>
              ) : null}
            </div>

            {/* Full Profile link */}
            <div className="px-6 py-3 border-t border-border-subtle">
              <Link
                to={`/pokemon/${encodeURIComponent(name)}`}
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-md text-sm font-medium text-neon hover:bg-neon/10 border border-neon/30 transition-colors"
              >
                Full Profile
                <ExternalLink size={14} />
              </Link>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * Adapt the `ApiGlobalOwnership` row's `owner` field into a `Player`-shaped
 * object. The side card's existing rendering primitives (TeamLink + CoachLink)
 * expect Player fields, so we synthesize the minimal subset the owner block
 * actually reads — coach data lives on the team query, not the ownership
 * endpoint, so we leave `owner` undefined and let the card show the team
 * abbrev as the secondary line.
 */
function ownerFromApi(row: ApiGlobalOwnership): Player {
  // The side-card owner block only reads id/teamName/teamAbbrev/teamColor/
  // name/record/owner — everything else is structural-only.
  return {
    id: row.owner.teamId,
    name: row.owner.teamName,
    teamName: row.owner.teamName,
    teamAbbrev: row.owner.teamAbbrev,
    teamColor: row.owner.teamColor,
    record: { wins: 0, losses: 0, differential: 0 },
    roster: [],
  } as Player;
}
