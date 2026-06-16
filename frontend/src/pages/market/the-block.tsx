import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { TypeChip } from '@/components/type-chip';
import { TeamLogo } from '@/components/team-logo';
import { usePokemonSideCard } from '@/components/pokemon-side-card-context';
import { pokemonRoute } from '@/lib/pokemon-route';
import { useLeague } from '@/lib/league-context';
import { useLeagueData } from '@/lib/league-data-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/types';
import type { ApiTradeBlockListing } from '@/lib/api';
import type { PokemonType } from '@/lib/pokemon';
import { Handshake, Plus, Send, X } from 'lucide-react';
import { ListOnBlockDialog } from './list-on-block-dialog';

export interface TheBlockProps {
  listings: ApiTradeBlockListing[];
  /** Open the trade composer pre-filled against this listing. */
  onOffer: (opts: { recipientTeamId: string; pokemonName: string }) => void;
  /** Parent reloads listings after a list/unlist. */
  onChanged: () => void;
  /** Viewer's team — enables listing your own mons + the remove affordance. */
  actingTeam: Player | undefined;
  deadlinePassed: boolean;
}

export function TheBlock({
  listings, onOffer, onChanged, actingTeam, deadlinePassed,
}: TheBlockProps): React.ReactElement {
  const league = useLeague();
  const { players } = useLeagueData();
  const { openSideCard } = usePokemonSideCard();
  const [listOpen, setListOpen] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const canList = !!actingTeam && !deadlinePassed;

  // Names this team already has on the block — disabled in the list dialog.
  const myListedNames = useMemo(() => {
    const set = new Set<string>();
    if (actingTeam) {
      for (const l of listings) {
        if (l.teamId === actingTeam.id) set.add(l.pokemonName);
      }
    }
    return set;
  }, [listings, actingTeam]);

  async function handleRemove(listingId: number) {
    if (removing != null) return;
    setRemoving(listingId);
    try {
      await api.deleteTradeBlockListing(listingId);
      toast.success('Removed from the block');
      onChanged();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
            <Handshake size={14} className="text-neon" />
            On the Block
            <Badge variant="outline" className="text-[11px] border-border-subtle text-text-muted">
              {listings.length}
            </Badge>
          </CardTitle>
          {canList && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-neon border-neon/30 hover:bg-neon/10"
              onClick={() => setListOpen(true)}
            >
              <Plus size={14} />
              List a Pokémon
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {listings.length === 0 ? (
          <EmptyState
            variant="quiet"
            title="Nothing on the block."
            subtitle="List a Pokemon to start the market."
            spriteSize="md"
            padding="sm"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {listings.map(listing => {
              const team = players.find(p => p.id === listing.teamId);
              const mon = team?.roster.find(m => m.name === listing.pokemonName);
              if (!team || !mon) return null;

              const isMine = !!actingTeam && team.id === actingTeam.id;
              const showOffer = !!actingTeam && !isMine && !deadlinePassed;
              const hasKd = mon.seasonStats.gp > 0;

              return (
                <div
                  key={listing.id}
                  className={cn(
                    'flex flex-col gap-2.5 rounded-lg border border-border-subtle bg-surface-overlay/20 p-3 transition-colors',
                    deadlinePassed ? 'opacity-50' : 'hover:border-border-default',
                  )}
                  style={{ ['--card-accent' as never]: team.teamColor }}
                >
                  {/* Mon header */}
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer"
                      onClick={() => openSideCard(mon.name)}
                      aria-label={`Preview ${mon.name}`}
                    >
                      <PokemonSprite name={mon.name} size="md" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          to={pokemonRoute(mon.name)}
                          className="text-sm font-mono font-medium text-text-primary hover:text-neon hover:underline transition-colors truncate"
                        >
                          {mon.name}
                        </Link>
                        <TierBadge points={mon.tier} />
                      </div>
                      <div className="mt-1.5">
                        <TypeChip types={mon.types as PokemonType[]} size="xs" />
                      </div>
                      {hasKd && (
                        <div className="mt-1.5 text-[11px] font-mono">
                          <span className="text-win">{mon.seasonStats.kills}</span>
                          <span className="text-text-muted">/</span>
                          <span className="text-loss">{mon.seasonStats.deaths}</span>
                          <span className="text-text-muted ml-1">({mon.seasonStats.gp}gp)</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Note */}
                  {listing.note && (
                    <p className="text-xs text-text-muted italic leading-snug">
                      "{listing.note}"
                    </p>
                  )}

                  {/* Owner + action */}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Link
                      to={`/league/${league.id}/teams/${team.id}`}
                      className="flex items-center gap-1.5 min-w-0 group"
                    >
                      <TeamLogo
                        abbrev={team.teamAbbrev}
                        color={team.teamColor}
                        size="sm"
                        logoPath={team.logoPath}
                      />
                      <span className="text-[11px] font-mono text-text-muted group-hover:text-text-secondary transition-colors truncate">
                        {team.teamAbbrev}
                      </span>
                    </Link>

                    {isMine ? (
                      <Button
                        size="xs"
                        variant="outline"
                        className="gap-1 text-text-muted border-border-subtle hover:text-loss hover:border-loss/30 hover:bg-loss/10"
                        disabled={removing === listing.id}
                        onClick={() => handleRemove(listing.id)}
                      >
                        <X size={12} />
                        Remove
                      </Button>
                    ) : showOffer ? (
                      <Button
                        size="xs"
                        className="gap-1 bg-neon text-surface-base hover:bg-neon/90"
                        onClick={() => onOffer({
                          recipientTeamId: listing.teamId,
                          pokemonName: listing.pokemonName,
                        })}
                      >
                        <Send size={12} />
                        Make offer
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {actingTeam && (
        <ListOnBlockDialog
          open={listOpen}
          onClose={() => setListOpen(false)}
          team={actingTeam}
          alreadyListed={myListedNames}
          onListed={onChanged}
        />
      )}
    </Card>
  );
}
