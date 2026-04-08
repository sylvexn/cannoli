import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ApiTradeBlockListing } from '@/lib/api';
import type { Player } from '@/lib/types';
import { useLeague } from '@/lib/league-context';
import { useAuth } from '@/lib/auth-context';
import { useLeagueData } from '@/lib/league-data-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { TierBadge } from '@/components/tier-badge';
import { Handshake, Trash2, ArrowDownToLine, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Owner-only actions on a team's own roster: list a Pokemon on the trade
 * block (with optional note), delist, and release a mon outright. Designed
 * to live below the roster table on the team-profile page.
 *
 * Trade block: only enabled during league.phase==='regular' and before the
 * trade deadline. Listings disappear automatically when a mon is traded
 * away or released — no manual cleanup needed.
 *
 * Release: only enabled during 'regular' phase, before the FA deadline.
 * Drops the mon from the roster (and any active listing on it) without a
 * pickup. Use with care — it shrinks the roster, the user's responsibility.
 */
export function RosterActions({ player }: { player: Player }) {
  const league = useLeague();
  const { user } = useAuth();
  const { refresh } = useLeagueData();

  const [listings, setListings] = useState<ApiTradeBlockListing[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);

  const isOwner = !!(user && player.userId != null && String(player.userId) === user.id);
  const phase = league.season.phase;
  const isRegular = phase === 'regular';
  const tradeDeadlinePassed = league.season.currentWeek > (league.season.tradeDeadlineWeek ?? 0);

  useEffect(() => {
    if (!isOwner) return;
    setLoadingListings(true);
    api.getTradeBlock(league.id)
      .then(all => setListings(all.filter(l => l.teamId === player.id)))
      .catch(() => {})
      .finally(() => setLoadingListings(false));
  }, [league.id, player.id, isOwner]);

  // ─── List on the block ──────────────────────────────────────────────
  const [listOpen, setListOpen] = useState(false);
  const [listMon, setListMon] = useState<string>('');
  const [listNote, setListNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const listedNames = new Set(listings.map(l => l.pokemonName));
  const listableRoster = player.roster.filter(r => !listedNames.has(r.name));

  async function handleCreate() {
    if (!listMon) return;
    setSubmitting(true);
    try {
      const { id } = await api.createTradeBlockListing(league.id, {
        pokemonName: listMon,
        note: listNote.trim() || undefined,
      });
      setListings(prev => [
        ...prev,
        { id, teamId: player.id, pokemonName: listMon, note: listNote.trim() || null },
      ]);
      toast.success(`Listed ${listMon} on the block`);
      setListOpen(false);
      setListMon('');
      setListNote('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to list');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelist(listing: ApiTradeBlockListing) {
    try {
      await api.deleteTradeBlockListing(listing.id);
      setListings(prev => prev.filter(l => l.id !== listing.id));
      toast.success(`Removed ${listing.pokemonName} from the block`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to delist');
    }
  }

  // ─── Release ─────────────────────────────────────────────────────────
  // Two-step: pick a candidate in the Select, then click Release to open
  // the confirmation. Confirming fires the API call.
  const [releaseCandidate, setReleaseCandidate] = useState<string>('');
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [releasing, setReleasing] = useState(false);

  async function handleRelease() {
    if (!releaseCandidate) return;
    setReleasing(true);
    try {
      await api.freeAgentRelease(league.id, {
        teamId: player.id,
        pokemonName: releaseCandidate,
      });
      toast.success(`Released ${releaseCandidate}`);
      setReleaseConfirmOpen(false);
      setReleaseCandidate('');
      // Drop from local listings if present
      setListings(prev => prev.filter(l => l.pokemonName !== releaseCandidate));
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || 'Release failed');
    } finally {
      setReleasing(false);
    }
  }

  if (!isOwner) return null;

  const canList = isRegular && !tradeDeadlinePassed;
  const canRelease = isRegular; // FA deadline gate enforced server-side

  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-heading font-semibold text-text-primary flex items-center gap-2 uppercase tracking-wider">
            <Handshake size={14} className="text-neon" />
            Manager Actions
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={!canList || listableRoster.length === 0}
              onClick={() => { setListMon(''); setListNote(''); setListOpen(true); }}
              className="text-neon border-neon/30 hover:bg-neon/10"
            >
              <Handshake size={11} className="mr-1" />
              List on the block
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-1 space-y-3">
        {/* Active listings */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1.5">
            Your active listings
          </div>
          {loadingListings ? (
            <div className="text-[11px] text-text-muted py-1">Loading…</div>
          ) : listings.length === 0 ? (
            <div className="text-[11px] text-text-muted py-1">No Pokemon listed.</div>
          ) : (
            <ul className="space-y-1">
              {listings.map(l => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-surface-overlay/30 border border-border-subtle/40"
                >
                  <PokemonSprite name={l.pokemonName} size="xs" />
                  <span className="text-xs font-mono text-text-primary">{l.pokemonName}</span>
                  {l.note && (
                    <span className="text-[10px] text-text-muted italic truncate flex-1 min-w-0">"{l.note}"</span>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => handleDelist(l)}
                    className="ml-auto text-loss hover:bg-loss/10"
                  >
                    <Trash2 size={11} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!canList && (
            <div className="flex items-start gap-1.5 text-[10px] text-text-muted mt-1.5">
              <AlertCircle size={10} className="shrink-0 mt-0.5" />
              <span>
                {!isRegular
                  ? `Listings open in regular season (current: ${phase}).`
                  : 'Trade deadline passed — listings are read-only.'}
              </span>
            </div>
          )}
        </div>

        {/* Release */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1.5">
            Release a Pokemon
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={releaseCandidate}
              onValueChange={setReleaseCandidate}
              disabled={!canRelease}
            >
              <SelectTrigger className="h-8 text-xs flex-1 bg-surface-overlay">
                <SelectValue placeholder="Select Pokemon to release..." />
              </SelectTrigger>
              <SelectContent>
                {[...player.roster]
                  .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name))
                  .map(r => (
                    <SelectItem key={r.name} value={r.name} className="text-xs">
                      {r.name} ({r.tier}pt)
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="xs"
              variant="outline"
              disabled={!releaseCandidate || !canRelease}
              onClick={() => setReleaseConfirmOpen(true)}
              className={cn(
                'text-loss border-loss/30 hover:bg-loss/10',
                !releaseCandidate && 'opacity-40',
              )}
            >
              <ArrowDownToLine size={11} className="mr-1" />
              Release
            </Button>
          </div>
          {!canRelease && (
            <div className="flex items-start gap-1.5 text-[10px] text-text-muted mt-1.5">
              <AlertCircle size={10} className="shrink-0 mt-0.5" />
              <span>Releases are only available during the regular season.</span>
            </div>
          )}
        </div>
      </CardContent>

      {/* List-on-block dialog */}
      <Dialog open={listOpen} onOpenChange={v => { if (!submitting) setListOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Handshake size={14} className="text-neon" />
              List on the block
            </DialogTitle>
            <DialogDescription>
              Lets other managers know this Pokemon is available for trade. You can delist anytime.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1 block">
                Pokemon
              </label>
              <Select value={listMon} onValueChange={setListMon}>
                <SelectTrigger className="h-9 text-xs bg-surface-overlay">
                  <SelectValue placeholder="Choose a Pokemon..." />
                </SelectTrigger>
                <SelectContent>
                  {listableRoster.map(r => (
                    <SelectItem key={r.name} value={r.name} className="text-xs">
                      <span className="flex items-center gap-2">
                        <PokemonSprite name={r.name} size="xs" />
                        {r.name}
                        <TierBadge points={r.tier} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {listableRoster.length === 0 && (
                <p className="text-[10px] text-text-muted mt-1">
                  All of your Pokemon are already listed.
                </p>
              )}
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1 block">
                Note (optional)
              </label>
              <Input
                value={listNote}
                onChange={e => setListNote(e.target.value)}
                placeholder="e.g. Looking for a fast attacker"
                maxLength={120}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              disabled={!listMon || submitting}
              onClick={handleCreate}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              <Handshake size={12} className="mr-1" />
              {submitting ? 'Listing…' : 'List'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release confirmation dialog */}
      <Dialog
        open={releaseConfirmOpen}
        onOpenChange={v => { if (!releasing) setReleaseConfirmOpen(v); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-loss">
              <ArrowDownToLine size={14} />
              Release {releaseCandidate}?
            </DialogTitle>
            <DialogDescription>
              This drops {releaseCandidate} from your roster without a
              replacement pickup. Your roster size will go down by 1.
              This cannot be undone — though other managers may pick the
              Pokemon up later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={releasing}
              onClick={() => setReleaseConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={releasing}
              onClick={handleRelease}
              className="bg-loss text-surface-base hover:bg-loss/90"
            >
              <ArrowDownToLine size={12} className="mr-1" />
              {releasing ? 'Releasing…' : 'Confirm release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Marker badge so users know the action exists in offseason */}
      {!isRegular && (
        <div className="px-3 pb-2">
          <Badge variant="outline" className="text-[9px] text-text-muted border-border-subtle">
            Manager actions reopen in regular season
          </Badge>
        </div>
      )}
    </Card>
  );
}

