import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { ApiAdminMatch } from '@/lib/api';
import { toast } from 'sonner';
import { NumberInput } from '@/components/ui/number-input';
import { POKEMON_TYPES } from '@/lib/pokemon';
import {
  ChevronDown, ChevronUp, Plus, Trash2, Swords, Gavel,
} from 'lucide-react';
import type { TeamNameResolver } from '@/lib/use-team-names';
import { getErrorMessage } from '@/lib/errors';

export type ResultMode = 'enter' | 'force';

interface PokemonEntry {
  name: string;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType: string;
}

const emptyEntry = (): PokemonEntry => ({ name: '', kills: 0, deaths: 0, teraUsed: false, teraType: '' });

export function MatchEntryDialog({ match, mode, teamNames, open, onOpenChange, onSaved }: {
  match: ApiAdminMatch | null;
  mode: ResultMode;
  teamNames: TeamNameResolver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Force mode can reassign which team sits on each side; enter mode tracks the
  // match's own home/away. selHome/selAway always hold the *effective* sides.
  const [selHomeTeamId, setSelHomeTeamId] = useState('');
  const [selAwayTeamId, setSelAwayTeamId] = useState('');
  const leagueTeams = match ? teamNames.list(match.leagueId) : [];
  const homeName = teamNames.name(selHomeTeamId);
  const awayName = teamNames.name(selAwayTeamId);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [replayUrl, setReplayUrl] = useState('');
  const [forceForfeit, setForceForfeit] = useState<'none' | 'home' | 'away' | 'both'>('none');
  const [forceNote, setForceNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPokemonData, setShowPokemonData] = useState(false);
  const [homePokemon, setHomePokemon] = useState<PokemonEntry[]>([]);
  const [awayPokemon, setAwayPokemon] = useState<PokemonEntry[]>([]);

  useEffect(() => {
    if (open && match) {
      setSelHomeTeamId(match.homeTeamId);
      setSelAwayTeamId(match.awayTeamId);
      setHomeScore(match.homeScore ?? 0);
      setAwayScore(match.awayScore ?? 0);
      setReplayUrl(match.replayUrl ?? '');
      setForceForfeit('none');
      setForceNote('');
      setShowPokemonData(false);
      setHomePokemon([]);
      setAwayPokemon([]);
    }
  }, [open, match]);

  async function submitResult() {
    if (!match) return;
    if (mode === 'force' && selHomeTeamId === selAwayTeamId) {
      toast.error('Home and away must be different teams');
      return;
    }
    setSubmitting(true);
    try {
      const pokemonData = showPokemonData
        ? [
            ...homePokemon.filter(p => p.name.trim()).map(p => ({
              teamId: selHomeTeamId,
              pokemonName: p.name.trim(),
              kills: p.kills,
              deaths: p.deaths,
              teraUsed: p.teraUsed,
              teraType: p.teraType || undefined,
            })),
            ...awayPokemon.filter(p => p.name.trim()).map(p => ({
              teamId: selAwayTeamId,
              pokemonName: p.name.trim(),
              kills: p.kills,
              deaths: p.deaths,
              teraUsed: p.teraUsed,
              teraType: p.teraType || undefined,
            })),
          ]
        : undefined;

      if (mode === 'force') {
        await api.forceMatchResult(match.id, {
          homeScore,
          awayScore,
          forfeitedBy: forceForfeit === 'none' ? null : forceForfeit,
          note: forceNote.trim() || undefined,
          pokemonData,
          homeTeamId: selHomeTeamId,
          awayTeamId: selAwayTeamId,
        });
        toast.success('Result force-recorded (audit logged)');
      } else {
        await api.recordMatchResult(match.id, {
          homeScore,
          awayScore,
          replayUrl: replayUrl || undefined,
          pokemonData,
        });
        toast.success('Result recorded');
      }
      onOpenChange(false);
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={showPokemonData ? 'max-w-2xl' : 'max-w-sm'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === 'force' ? (
              <>
                <Gavel size={16} className="text-loss" />
                Force Match Result
              </>
            ) : (
              <>
                <Swords size={16} className="text-neon" />
                Enter Match Result
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {match && `${homeName} vs ${awayName} (Week ${match.week})`}
            {mode === 'force' && match?.status === 'completed' && (
              <span className="block mt-1 text-loss text-[10px]">
                Overwriting an already-completed match. Prior K/D snapshot is preserved in the activity log.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {mode === 'force' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Home Team</label>
                <Select value={selHomeTeamId} onValueChange={(v) => setSelHomeTeamId(v ?? '')}>
                  <SelectTrigger className="h-8 text-xs bg-surface-overlay">
                    <SelectValue placeholder="Select team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {leagueTeams.map(t => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Away Team</label>
                <Select value={selAwayTeamId} onValueChange={(v) => setSelAwayTeamId(v ?? '')}>
                  <SelectTrigger className="h-8 text-xs bg-surface-overlay">
                    <SelectValue placeholder="Select team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {leagueTeams.map(t => (
                      <SelectItem key={t.id} value={t.id} className="text-xs">{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                {homeName} (Home)
              </label>
              <NumberInput value={homeScore} onChange={setHomeScore} min={0} max={6} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                {awayName} (Away)
              </label>
              <NumberInput value={awayScore} onChange={setAwayScore} min={0} max={6} />
            </div>
          </div>

          <div className="text-[10px] text-text-muted">
            Winner: <span className="text-text-primary font-medium">
              {homeScore === awayScore ? 'Tie' :
                homeScore > awayScore ? homeName : awayName}
            </span>
          </div>

          {mode === 'force' ? (
            <>
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Forfeit</label>
                <Select value={forceForfeit} onValueChange={(v) => setForceForfeit((v as typeof forceForfeit) ?? 'none')}>
                  <SelectTrigger className="h-8 text-xs bg-surface-overlay">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">No forfeit</SelectItem>
                    <SelectItem value="home" className="text-xs">Home forfeited</SelectItem>
                    <SelectItem value="away" className="text-xs">Away forfeited</SelectItem>
                    <SelectItem value="both" className="text-xs">Double forfeit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Reason / note (audit log)</label>
                <Input
                  value={forceNote}
                  onChange={e => setForceNote(e.target.value)}
                  placeholder="e.g. dispute resolved in home team's favor"
                  className="h-8 text-xs bg-surface-overlay"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Replay URL</label>
              <Input
                value={replayUrl}
                onChange={e => setReplayUrl(e.target.value)}
                placeholder="https://replay.pokemonshowdown.com/..."
                className="h-8 text-xs bg-surface-overlay"
              />
            </div>
          )}

          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-neon hover:text-neon/80 transition-colors"
            onClick={() => {
              const next = !showPokemonData;
              setShowPokemonData(next);
              if (next && homePokemon.length === 0) {
                setHomePokemon(Array.from({ length: 6 }, emptyEntry));
                setAwayPokemon(Array.from({ length: 6 }, emptyEntry));
              }
            }}
          >
            {showPokemonData ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showPokemonData ? 'Hide' : 'Add'} per-Pokemon K/D data
          </button>

          {showPokemonData && match && (
            <div className="grid grid-cols-2 gap-4">
              <PokemonKDSection
                label={`${homeName} (Home)`}
                entries={homePokemon}
                onChange={setHomePokemon}
              />
              <PokemonKDSection
                label={`${awayName} (Away)`}
                entries={awayPokemon}
                onChange={setAwayPokemon}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={submitting}
            className={mode === 'force'
              ? 'bg-loss text-surface-base hover:bg-loss/90'
              : 'bg-neon text-surface-base hover:bg-neon/90'}
            onClick={submitResult}
          >
            {submitting
              ? 'Saving...'
              : mode === 'force'
                ? 'Force Result'
                : 'Save Result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-Pokemon K/D entry section for one side of a match */
function PokemonKDSection({ label, entries, onChange }: {
  label: string;
  entries: PokemonEntry[];
  onChange: (entries: PokemonEntry[]) => void;
}) {
  function updateEntry(index: number, field: string, value: unknown) {
    const next = entries.map((e, i) => i === index ? { ...e, [field]: value } : e);
    onChange(next);
  }

  function addEntry() {
    onChange([...entries, emptyEntry()]);
  }

  function removeEntry(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
      <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
        {entries.map((entry, i) => (
          <div key={i} className="rounded-md border border-border-subtle bg-surface-overlay/30 p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                value={entry.name}
                onChange={e => updateEntry(i, 'name', e.target.value)}
                placeholder="Pokemon name"
                className="h-6 text-[11px] bg-surface-overlay flex-1"
              />
              <button
                type="button"
                onClick={() => removeEntry(i)}
                className="p-0.5 rounded hover:bg-loss/10 text-text-muted hover:text-loss transition-colors"
              >
                <Trash2 size={10} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-text-muted">K</span>
                <NumberInput value={entry.kills} onChange={v => updateEntry(i, 'kills', v)} min={0} max={6} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-text-muted">D</span>
                <NumberInput value={entry.deaths} onChange={v => updateEntry(i, 'deaths', v)} min={0} max={1} />
              </div>
              <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                <input
                  type="checkbox"
                  checked={entry.teraUsed}
                  onChange={e => updateEntry(i, 'teraUsed', e.target.checked)}
                  className="h-3 w-3 rounded accent-neon"
                />
                <span className="text-[9px] text-text-muted">Tera</span>
              </label>
            </div>
            {entry.teraUsed && (
              <Select value={entry.teraType} onValueChange={v => updateEntry(i, 'teraType', v)}>
                <SelectTrigger className="h-6 text-[10px] bg-surface-overlay">
                  <SelectValue placeholder="Tera type..." />
                </SelectTrigger>
                <SelectContent>
                  {POKEMON_TYPES.map(t => (
                    <SelectItem key={t} value={t} className="text-[10px] capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        ))}
      </div>
      {entries.length < 6 && (
        <Button size="xs" variant="outline" onClick={addEntry} className="w-full text-[10px] h-6">
          <Plus size={10} />
          Add Pokemon
        </Button>
      )}
    </div>
  );
}
