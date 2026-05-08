/**
 * Per-pin award dialog. Renders only the metadata fields the pin actually
 * needs (driven by `PIN_METADATA_SCHEMA` in lib/pin-metadata-schema.ts).
 *
 * Common controls (always rendered):
 *   - Coach picker (debounced username search; shadcn Input + result list).
 *   - Optional Season ID (defaults to the season selected in the parent tab).
 *
 * Conditional controls (per metadata schema):
 *   - `pokemon` → Pokémon picker (debounced /api/pokemon list).
 *   - `nickname` → text input (used by `rotom` only).
 *   - `leagueId` → league dropdown.
 *
 * On submit, calls api.awardPin with the assembled metadata blob and bubbles
 * the new pin id back via `onAwarded`.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Pin } from '@/components/pin';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api, type ApiPinDefinition, type ApiAuthUser, type ApiLeague } from '@/lib/api';
import { pinMetadataFields } from '@/lib/pin-metadata-schema';

interface AwardDialogProps {
  def: ApiPinDefinition;
  /** Default season id pre-filled in the form (the parent tab's selection).
   *  Admin can override by typing in the season id field. */
  defaultSeasonId: number | null;
  users: ApiAuthUser[];
  leagues: ApiLeague[];
  onClose: () => void;
  onAwarded: () => void;
}

export function AwardDialog({
  def, defaultSeasonId, users, leagues, onClose, onAwarded,
}: AwardDialogProps) {
  const fields = pinMetadataFields(def.id);
  const needsPokemon = fields.includes('pokemon');
  const needsNickname = fields.includes('nickname');
  const needsLeague = fields.includes('leagueId');

  const [userId, setUserId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [pokemonName, setPokemonName] = useState('');
  const [pokemonSearch, setPokemonSearch] = useState('');
  const [pokemonResults, setPokemonResults] = useState<{ name: string; tier: number }[]>([]);
  const [pokemonSearching, setPokemonSearching] = useState(false);
  const pokemonTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [nickname, setNickname] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [seasonIdText, setSeasonIdText] = useState(
    defaultSeasonId != null ? String(defaultSeasonId) : '',
  );
  const [submitting, setSubmitting] = useState(false);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users.slice(0, 25);
    const q = userSearch.toLowerCase();
    return users.filter(u => u.username.toLowerCase().includes(q)).slice(0, 25);
  }, [users, userSearch]);

  const selectedUser = useMemo(
    () => users.find(u => parseInt(u.id) === userId) ?? null,
    [users, userId],
  );

  // Debounced pokemon search — only fires when the schema actually needs it.
  useEffect(() => {
    if (!needsPokemon) return;
    if (!pokemonSearch.trim()) { setPokemonResults([]); return; }
    clearTimeout(pokemonTimerRef.current);
    pokemonTimerRef.current = setTimeout(async () => {
      setPokemonSearching(true);
      try {
        const results = await api.getPokemonList({ search: pokemonSearch, limit: 20 });
        setPokemonResults(results.map(p => ({ name: p.name, tier: p.tier })));
      } catch {
        setPokemonResults([]);
      } finally {
        setPokemonSearching(false);
      }
    }, 250);
    return () => clearTimeout(pokemonTimerRef.current);
  }, [pokemonSearch, needsPokemon]);

  const canSubmit =
    userId != null &&
    (!needsPokemon || pokemonName.trim().length > 0) &&
    (!needsNickname || nickname.trim().length > 0) &&
    (!needsLeague || leagueId.length > 0);

  async function handleSubmit() {
    if (!canSubmit || userId == null) return;
    const metadata: Record<string, unknown> = {};
    if (needsPokemon && pokemonName.trim()) metadata.pokemon = pokemonName.trim();
    if (needsNickname && nickname.trim()) metadata.nickname = nickname.trim();
    if (needsLeague && leagueId) metadata.leagueId = leagueId;

    const seasonNum = seasonIdText.trim() ? parseInt(seasonIdText.trim()) : null;
    if (seasonIdText.trim() && (seasonNum == null || !Number.isFinite(seasonNum))) {
      toast.error('Season id must be a number');
      return;
    }

    setSubmitting(true);
    try {
      await api.awardPin({
        userId,
        pinDefId: def.id,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        seasonId: seasonNum,
      });
      toast.success(`Awarded '${def.name}' to ${selectedUser?.username}`);
      onAwarded();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Award failed';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Pin def={def} size="sm" noTooltip />
            <div>
              <DialogTitle className="leading-tight">Award {def.name}</DialogTitle>
              {def.description && (
                <DialogDescription className="leading-snug">
                  {def.description}
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          {/* Coach picker — always rendered. */}
          <div className="space-y-1">
            <div className="text-[11px] text-text-muted">Coach</div>
            <Input
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setUserId(null); }}
              placeholder="Search by username"
              className="h-8 text-xs"
            />
            {userSearch && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-border-default bg-surface-base">
                {filteredUsers.length === 0 ? (
                  <div className="text-[11px] text-text-muted px-2 py-1">No matches</div>
                ) : filteredUsers.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => { setUserId(parseInt(u.id)); setUserSearch(u.username); }}
                    className={cn(
                      'w-full text-left px-2 py-1 text-xs hover:bg-surface-overlay/40 transition-colors flex items-center justify-between',
                      userId === parseInt(u.id) && 'bg-surface-overlay/60',
                    )}
                  >
                    <span className="font-mono">{u.username}</span>
                    <span className="text-[10px] uppercase text-text-muted">{u.role}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedUser && (
              <div className="text-[11px] text-win">Selected: {selectedUser.username}</div>
            )}
          </div>

          {/* Pokémon picker — `pokemon` field. */}
          {needsPokemon && (
            <div className="space-y-1">
              <div className="text-[11px] text-text-muted">Pokémon</div>
              <Input
                value={pokemonSearch}
                onChange={e => { setPokemonSearch(e.target.value); setPokemonName(''); }}
                placeholder="Search Pokémon"
                className="h-8 text-xs"
              />
              {pokemonSearch && pokemonName === '' && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border-default bg-surface-base">
                  {pokemonSearching ? (
                    <div className="text-[11px] text-text-muted px-2 py-1">Searching...</div>
                  ) : pokemonResults.length === 0 ? (
                    <div className="text-[11px] text-text-muted px-2 py-1">No matches</div>
                  ) : pokemonResults.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => { setPokemonName(p.name); setPokemonSearch(p.name); }}
                      className="w-full text-left px-2 py-1 text-xs hover:bg-surface-overlay/40 transition-colors flex items-center justify-between"
                    >
                      <span>{p.name}</span>
                      <span className="text-[10px] text-text-muted font-mono">T{p.tier}</span>
                    </button>
                  ))}
                </div>
              )}
              {pokemonName && (
                <div className="text-[11px] text-win">Selected: {pokemonName}</div>
              )}
            </div>
          )}

          {/* Nickname — `nickname` field (currently rotom only). */}
          {needsNickname && (
            <div className="space-y-1">
              <div className="text-[11px] text-text-muted">Nickname</div>
              <Input
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="The nickname as written on the team"
                className="h-8 text-xs"
              />
            </div>
          )}

          {/* League picker — `leagueId` field. */}
          {needsLeague && (
            <div className="space-y-1">
              <div className="text-[11px] text-text-muted">League</div>
              <select
                value={leagueId}
                onChange={e => setLeagueId(e.target.value)}
                className="w-full h-8 rounded-md border border-border-default bg-surface-raised text-xs px-2"
              >
                <option value="">Select a league...</option>
                {leagues.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Season — defaults from the parent selector but stays editable. */}
          <div className="space-y-1">
            <div className="text-[11px] text-text-muted">Season ID</div>
            <Input
              value={seasonIdText}
              onChange={e => setSeasonIdText(e.target.value)}
              placeholder="e.g. 11"
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} size="sm">Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} size="sm">
            <Sparkles size={12} />
            {submitting ? 'Awarding...' : 'Award pin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
