/**
 * Post-draft summary surface — rendered when state.view === 'active' and
 * state.status === 'complete'. Read-only retrospective of the draft that just
 * finished. Captain gate is embedded prominently when the league is still in
 * phase=draft (some team hasn't locked their captains yet).
 *
 * Sections:
 *   - Header: total picks, total points spent, duration (if available)
 *   - Captain gate (when applicable)
 *   - Round-by-round grid: every team's pick per round
 *   - Per-team mini-cards: roster, points used, points remaining, captain status
 *   - Value picks: simple heuristic — highest-tier picks landed in the second
 *     half of their round (placeholder until a richer metric is wired up)
 *
 * Kept under 400 LOC. Uses existing primitives (TeamLogo, TierBadge,
 * PokemonSprite, Badge).
 */

import { useMemo } from 'react';
import { ArrowLeft, Crown, Sparkles, Trophy } from 'lucide-react';
import { TeamLink } from '@/components/team-link';
import { TierBadge } from '@/components/tier-badge';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { pokemonRoute } from '@/lib/pokemon-route';
import type { Player } from '@/lib/types';
import type { Acquisition, DraftPickEntry } from './types';
import { DraftCaptainGate } from './draft-captain-gate';

interface DraftCompleteSummaryProps {
  picks: DraftPickEntry[];
  draftOrder: Player[];
  teamRosters: Map<string, { name: string; tier: number; acquisition: Acquisition }[]>;
  teamPoints: Map<string, number>;
  pointCap: number;
  /** All league players — used by the captain gate. */
  players: Player[];
  /** Active user's team id (for the captain CTA). */
  userTeamId: string | null;
  leagueId: string;
  /** Configured tera captain count per team. */
  teraCaptainSlots: number;
  /** True while the league is still in phase=draft (captains pending). */
  showCaptainGate: boolean;
  onBackToHistory: () => void;
}

export function DraftCompleteSummary({
  picks, draftOrder, teamRosters, teamPoints, pointCap,
  players, userTeamId, leagueId, teraCaptainSlots,
  showCaptainGate, onBackToHistory,
}: DraftCompleteSummaryProps) {
  const totalPicks = picks.length;
  const totalPoints = useMemo(
    () => picks.reduce((sum, p) => sum + p.tier, 0),
    [picks],
  );
  const totalRounds = useMemo(
    () => picks.reduce((max, p) => Math.max(max, p.round), 0),
    [picks],
  );

  // Group picks by round for the round-by-round grid
  const picksByRound = useMemo(() => {
    const map = new Map<number, DraftPickEntry[]>();
    for (const pick of picks) {
      const arr = map.get(pick.round) ?? [];
      arr.push(pick);
      map.set(pick.round, arr);
    }
    // Sort each round by pick index so the grid reads left-to-right in draft order
    for (const arr of map.values()) {
      arr.sort((a, b) => a.pick - b.pick);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [picks]);

  // "Value picks" heuristic: highest-tier picks that landed in the second half
  // of their round. Top 3 by tier, then by absolute round position (later = better steal).
  const valuePicks = useMemo(() => {
    const teamCount = draftOrder.length || 1;
    const halfRound = teamCount / 2;
    const candidates = picks.filter(p => p.pick > halfRound);
    return [...candidates]
      .sort((a, b) => b.tier - a.tier || b.pick - a.pick)
      .slice(0, 3);
  }, [picks, draftOrder.length]);

  const playerById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of draftOrder) map.set(p.id, p);
    return map;
  }, [draftOrder]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-2 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToHistory}
            className="h-7 px-2 text-xs gap-1 text-text-muted hover:text-neon"
          >
            <ArrowLeft size={12} />
            Back to Season View
          </Button>
          <h1 className="text-lg font-mono font-bold tracking-tight uppercase">
            <span className="text-win">Draft</span>
            <span className="text-text-primary ml-1">Complete</span>
          </h1>
          <div className="flex items-center gap-2 text-[11px] font-mono text-text-muted">
            <span><span className="text-text-primary">{totalPicks}</span> picks</span>
            <span className="text-text-muted/40">·</span>
            <span><span className="text-text-primary">{totalPoints}</span>pt spent</span>
            <span className="text-text-muted/40">·</span>
            <span><span className="text-text-primary">{totalRounds}</span> rounds</span>
          </div>
        </div>
        <Badge className="bg-win/10 text-win border-win/30 gap-1.5 text-[10px] font-mono">
          <Trophy size={10} />
          Final
        </Badge>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 pb-6 pr-2">
          {/* Captain gate — embedded prominently when applicable */}
          {showCaptainGate && (
            <DraftCaptainGate
              players={players}
              userTeamId={userTeamId}
              leagueId={leagueId}
              teraCaptainSlots={teraCaptainSlots}
            />
          )}

          {/* Value picks callout — placeholder heuristic */}
          {valuePicks.length > 0 && (
            <section className="rounded-lg border border-border-default bg-surface-raised/50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={13} className="text-pink" />
                <h2 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider">
                  Value Picks
                </h2>
                <span className="text-[10px] font-mono text-text-muted/60">
                  highest-tier picks in the back half of their round
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {valuePicks.map(pick => {
                  const player = playerById.get(pick.playerId);
                  return (
                    <div
                      key={pick.overallPick}
                      className="flex items-center gap-2 rounded-md border border-pink/20 bg-pink/[0.04] px-2 py-1.5"
                    >
                      <PokemonSprite name={pick.pokemonName} size="sm" />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={pokemonRoute(pick.pokemonName)}
                          className="text-xs font-medium text-text-primary truncate hover:text-pink transition-colors block"
                        >
                          {pick.pokemonName}
                        </Link>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono text-text-muted">
                          {player && (
                            <TeamLink
                              team={{
                                leagueId,
                                teamId: player.id,
                                teamName: player.teamName,
                                teamAbbrev: player.teamAbbrev,
                                teamColor: player.teamColor,
                                logoPath: player.logoPath,
                                record: player.record,
                              }}
                              logoOnly
                              logoSize="sm"
                            />
                          )}
                          <span>R{pick.round}·P{pick.pick}</span>
                        </div>
                      </div>
                      <TierBadge points={pick.tier} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Round-by-round grid */}
          <section className="rounded-lg border border-border-default bg-surface-raised/50 p-3">
            <h2 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider mb-2">
              Round by Round
            </h2>
            <div className="space-y-2">
              {picksByRound.map(([round, roundPicks]) => (
                <RoundRow
                  key={round}
                  round={round}
                  picks={roundPicks}
                  playerById={playerById}
                  leagueId={leagueId}
                />
              ))}
            </div>
          </section>

          {/* Per-team mini-cards */}
          <section>
            <h2 className="text-xs font-heading font-bold text-text-primary uppercase tracking-wider mb-2 px-1">
              Final Rosters
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {draftOrder.map(player => (
                <TeamSummaryCard
                  key={player.id}
                  player={player}
                  roster={teamRosters.get(player.id) ?? []}
                  points={teamPoints.get(player.id) ?? 0}
                  pointCap={pointCap}
                  teraCaptainSlots={teraCaptainSlots}
                  leagueId={leagueId}
                />
              ))}
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface RoundRowProps {
  round: number;
  picks: DraftPickEntry[];
  playerById: Map<string, Player>;
  leagueId: string;
}

function RoundRow({ round, picks, playerById, leagueId }: RoundRowProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-12 shrink-0 pt-0.5">
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
          Round
        </span>
        <div className="text-lg font-heading font-bold text-text-primary leading-none">
          {round}
        </div>
      </div>
      <div className="flex-1 flex flex-wrap gap-1.5">
        {picks.map(pick => {
          const player = playerById.get(pick.playerId);
          return (
            <div
              key={pick.overallPick}
              className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-overlay/30 px-1.5 py-1"
              title={`${player?.teamAbbrev ?? '?'} · ${pick.pokemonName} · R${pick.round}P${pick.pick}`}
            >
              {player && (
                <TeamLink
                  team={{
                    leagueId,
                    teamId: player.id,
                    teamName: player.teamName,
                    teamAbbrev: player.teamAbbrev,
                    teamColor: player.teamColor,
                    logoPath: player.logoPath,
                    record: player.record,
                  }}
                  logoOnly
                  logoSize="sm"
                />
              )}
              <PokemonSprite name={pick.pokemonName} size="xs" />
              <Link
                to={pokemonRoute(pick.pokemonName)}
                className="text-[10px] font-medium text-text-secondary hover:text-neon truncate max-w-[80px] transition-colors"
              >
                {pick.pokemonName}
              </Link>
              <TierBadge points={pick.tier} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TeamSummaryCardProps {
  player: Player;
  roster: { name: string; tier: number; acquisition: Acquisition }[];
  points: number;
  pointCap: number;
  teraCaptainSlots: number;
  leagueId: string;
}

function TeamSummaryCard({
  player, roster, points, pointCap, teraCaptainSlots, leagueId,
}: TeamSummaryCardProps) {
  const remaining = pointCap - points;
  const captainsLocked = !!player.captainsLocked;

  return (
    <div className="rounded-lg border border-border-default bg-surface-raised p-2">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1.5 border-b border-border-subtle">
        <TeamLink
          team={{
            leagueId,
            teamId: player.id,
            teamName: player.teamName,
            teamAbbrev: player.teamAbbrev,
            teamColor: player.teamColor,
            logoPath: player.logoPath,
            record: player.record,
          }}
          logoOnly
          logoSize="md"
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-heading font-bold text-text-primary truncate">
            {player.teamAbbrev}
          </div>
          <div className="text-[10px] font-mono text-text-muted truncate">
            {player.name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-text-muted">
            {points}<span className="text-text-muted/40">/{pointCap}</span>
          </div>
          <div className={cn(
            'text-[10px] font-mono font-bold',
            remaining < 5 ? 'text-loss' : remaining < 15 ? 'text-draw' : 'text-neon',
          )}>
            {remaining}pt left
          </div>
        </div>
      </div>

      {/* Captain status */}
      {teraCaptainSlots > 0 && (
        <div className={cn(
          'mt-1.5 px-1.5 py-1 rounded flex items-center gap-1.5 text-[10px] font-mono',
          captainsLocked
            ? 'bg-win/10 text-win border border-win/20'
            : 'bg-pink/10 text-pink border border-pink/20',
        )}>
          <Crown size={10} />
          {captainsLocked
            ? <span>Captains locked</span>
            : <span>{teraCaptainSlots} captain{teraCaptainSlots === 1 ? '' : 's'} pending</span>
          }
        </div>
      )}

      {/* Roster list */}
      <div className="mt-1.5 space-y-0.5">
        {roster.length === 0 ? (
          <div className="text-[10px] text-text-muted text-center py-1">No picks</div>
        ) : roster.map(mon => (
          <div
            key={mon.name}
            className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-overlay/40 transition-colors"
          >
            <PokemonSprite name={mon.name} size="xs" />
            <Link
              to={pokemonRoute(mon.name)}
              className="text-[11px] text-text-primary flex-1 min-w-0 truncate hover:text-neon transition-colors"
            >
              {mon.name}
            </Link>
            <TierBadge points={mon.tier} />
          </div>
        ))}
      </div>
    </div>
  );
}
