import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { NumberInput } from '@/components/ui/number-input';
import { POKEMON_TYPES } from '@/lib/pokemon';
import {
  AlertTriangle, CheckCircle2, Clock, Swords, Shield,
  ChevronDown, ChevronUp, Plus, Trash2,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  scheduled: { label: 'Scheduled', color: 'text-text-muted border-border-subtle', icon: Clock },
  ready: { label: 'Ready', color: 'text-draw border-draw/30 bg-draw/10', icon: Shield },
  in_progress: { label: 'Live', color: 'text-neon border-neon/30 bg-neon/10', icon: Swords },
  completed: { label: 'Completed', color: 'text-win border-win/30 bg-win/10', icon: CheckCircle2 },
  disputed: { label: 'Disputed', color: 'text-loss border-loss/30 bg-loss/10', icon: AlertTriangle },
};

export function AdminMatches() {
  const { leagues } = useAppData();
  const [matches, setMatches] = useState<ApiAdminMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  // Result entry dialog
  const [resultOpen, setResultOpen] = useState(false);
  const [resultMatch, setResultMatch] = useState<ApiAdminMatch | null>(null);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [replayUrl, setReplayUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPokemonData, setShowPokemonData] = useState(false);

  interface PokemonEntry {
    name: string;
    kills: number;
    deaths: number;
    teraUsed: boolean;
    teraType: string;
  }
  const emptyEntry = (): PokemonEntry => ({ name: '', kills: 0, deaths: 0, teraUsed: false, teraType: '' });
  const [homePokemon, setHomePokemon] = useState<PokemonEntry[]>([]);
  const [awayPokemon, setAwayPokemon] = useState<PokemonEntry[]>([]);

  function fetchMatches() {
    setLoading(true);
    api.getAdminMatches({
      leagueId: leagueFilter !== 'all' ? leagueFilter : undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
    }).then(data => {
      setMatches(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  useEffect(() => { fetchMatches(); }, [leagueFilter, statusFilter]);

  // Group by week
  const matchesByWeek = useMemo(() => {
    const groups = new Map<number, ApiAdminMatch[]>();
    for (const m of matches) {
      const existing = groups.get(m.week) ?? [];
      existing.push(m);
      groups.set(m.week, existing);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [matches]);

  // Counts
  const warningCount = matches.filter(m => m.warnings.length > 0).length;
  const disputedCount = matches.filter(m => m.status === 'disputed').length;
  const completedCount = matches.filter(m => m.status === 'completed').length;

  function openResultEntry(match: ApiAdminMatch) {
    setResultMatch(match);
    setHomeScore(match.homeScore ?? 0);
    setAwayScore(match.awayScore ?? 0);
    setReplayUrl(match.replayUrl ?? '');
    setShowPokemonData(false);
    setHomePokemon([]);
    setAwayPokemon([]);
    setResultOpen(true);
  }

  async function submitResult() {
    if (!resultMatch) return;
    setSubmitting(true);
    try {
      const pokemonData = showPokemonData
        ? [
            ...homePokemon.filter(p => p.name.trim()).map(p => ({
              teamId: resultMatch.homeTeamId,
              pokemonName: p.name.trim(),
              kills: p.kills,
              deaths: p.deaths,
              teraUsed: p.teraUsed,
              teraType: p.teraType || undefined,
            })),
            ...awayPokemon.filter(p => p.name.trim()).map(p => ({
              teamId: resultMatch.awayTeamId,
              pokemonName: p.name.trim(),
              kills: p.kills,
              deaths: p.deaths,
              teraUsed: p.teraUsed,
              teraType: p.teraType || undefined,
            })),
          ]
        : undefined;

      await api.recordMatchResult(resultMatch.id, {
        homeScore,
        awayScore,
        replayUrl: replayUrl || undefined,
        pokemonData,
      });
      toast.success('Result recorded');
      setResultOpen(false);
      fetchMatches();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDismissWarnings(matchId: string) {
    try {
      await api.dismissMatchWarnings(matchId);
      toast.success('Warnings dismissed');
      fetchMatches();
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  const leagueMap = useMemo(() => new Map(leagues.map(l => [l.id, l])), [leagues]);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="text-text-primary font-mono font-medium">{matches.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={12} className="text-win" />
          <span className="text-text-primary font-mono">{completedCount}</span>
        </div>
        {disputedCount > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-loss" />
            <span className="text-loss font-mono">{disputedCount} disputed</span>
          </div>
        )}
        {warningCount > 0 && (
          <Badge variant="outline" className="text-draw border-draw/30 bg-draw/10 text-[10px]">
            <AlertTriangle size={10} />
            {warningCount} with warnings
          </Badge>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={leagueFilter} onValueChange={(v) => setLeagueFilter(v ?? 'all')}>
          <SelectTrigger className="w-[160px] h-8 text-xs bg-surface-overlay">
            <SelectValue placeholder="All Leagues" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Leagues</SelectItem>
            {leagues.map(l => (
              <SelectItem key={l.id} value={l.id} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name.replace(' League', '')}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-[140px] h-8 text-xs bg-surface-overlay">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key} className="text-xs">{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Match list by week */}
      {loading ? (
        <p className="text-sm text-text-muted text-center py-8">Loading matches...</p>
      ) : matchesByWeek.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No matches found</p>
      ) : (
        <div className="space-y-3">
          {matchesByWeek.map(([week, weekMatches]) => (
            <Card key={week} className="bg-surface-raised border-border-default">
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-[10px] font-mono font-bold text-text-muted uppercase tracking-widest">
                  Week {week}
                  <span className="text-text-muted/50 ml-2">({weekMatches.length} matches)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border-subtle/20">
                  {weekMatches.map(match => {
                    const league = leagueMap.get(match.leagueId);
                    const statusCfg = STATUS_CONFIG[match.status] ?? STATUS_CONFIG.scheduled;
                    const StatusIcon = statusCfg.icon;
                    const hasWarnings = match.warnings.length > 0;
                    const isExpanded = expandedMatch === match.id;

                    return (
                      <div key={match.id}>
                        <div
                          className={cn(
                            'flex items-center gap-2.5 px-4 py-2 transition-colors cursor-pointer',
                            'hover:bg-surface-overlay/20',
                            hasWarnings && 'bg-loss/5',
                          )}
                          onClick={() => setExpandedMatch(isExpanded ? null : match.id)}
                        >
                          {/* League dot */}
                          {league && (
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
                          )}

                          {/* Teams */}
                          <div className="flex items-center gap-1.5 min-w-[140px]">
                            <span className="text-xs font-mono text-text-primary">{match.homeTeamId}</span>
                            <span className="text-[10px] text-text-muted">vs</span>
                            <span className="text-xs font-mono text-text-primary">{match.awayTeamId}</span>
                          </div>

                          {/* Score */}
                          <div className="w-[60px] text-center">
                            {match.homeScore !== null ? (
                              <span className="text-xs font-mono font-medium text-text-primary">
                                {match.homeScore} - {match.awayScore}
                              </span>
                            ) : (
                              <span className="text-[10px] text-text-muted">—</span>
                            )}
                          </div>

                          {/* Status */}
                          <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1', statusCfg.color)}>
                            <StatusIcon size={10} />
                            {statusCfg.label}
                          </Badge>

                          {/* Warning indicator */}
                          {hasWarnings && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-draw border-draw/30 bg-draw/10 gap-1">
                              <AlertTriangle size={10} />
                              {match.warnings.length}
                            </Badge>
                          )}

                          {/* Phase badge */}
                          {match.phase === 'playoffs' && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-pink border-pink/30">
                              {match.playoffRound?.toUpperCase()}
                            </Badge>
                          )}

                          <div className="flex-1" />

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            {(match.status === 'scheduled' || match.status === 'ready') && (
                              <Button
                                size="xs"
                                variant="outline"
                                className="text-neon border-neon/30 hover:bg-neon/10 h-6 text-[10px]"
                                onClick={e => { e.stopPropagation(); openResultEntry(match); }}
                              >
                                Enter Result
                              </Button>
                            )}
                            {hasWarnings && (
                              <Button
                                size="xs"
                                variant="outline"
                                className="text-draw border-draw/30 hover:bg-draw/10 h-6 text-[10px]"
                                onClick={e => { e.stopPropagation(); handleDismissWarnings(match.id); }}
                              >
                                Dismiss
                              </Button>
                            )}
                          </div>

                          {isExpanded ? <ChevronUp size={12} className="text-text-muted" /> : <ChevronDown size={12} className="text-text-muted" />}
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-3 pt-1 bg-surface-overlay/10 space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-text-muted">
                              <div>Match ID: <span className="text-text-secondary font-mono">{match.id}</span></div>
                              <div>League: <span className="text-text-secondary">{league?.name ?? match.leagueId}</span></div>
                              {match.psRoomId && <div>PS Room: <span className="text-text-secondary font-mono">{match.psRoomId}</span></div>}
                              {match.startedAt && <div>Started: <span className="text-text-secondary">{new Date(match.startedAt).toLocaleString()}</span></div>}
                              {match.completedAt && <div>Completed: <span className="text-text-secondary">{new Date(match.completedAt).toLocaleString()}</span></div>}
                              {match.replayUrl && (
                                <div>
                                  Replay: <a href={match.replayUrl} target="_blank" rel="noopener" className="text-neon hover:underline">{match.replayUrl}</a>
                                </div>
                              )}
                            </div>

                            {/* Warnings */}
                            {hasWarnings && (
                              <div className="space-y-1 rounded-md border border-draw/20 bg-draw/5 p-2">
                                <div className="flex items-center gap-1.5 text-draw font-medium">
                                  <AlertTriangle size={12} />
                                  Validation Warnings
                                </div>
                                <ul className="space-y-0.5 pl-5 list-disc text-text-secondary">
                                  {match.warnings.map((w, i) => (
                                    <li key={i}>{w}</li>
                                  ))}
                                </ul>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="text-draw border-draw/30 hover:bg-draw/10 mt-1"
                                  onClick={() => handleDismissWarnings(match.id)}
                                >
                                  <CheckCircle2 size={12} />
                                  Approve & Dismiss
                                </Button>
                              </div>
                            )}

                            {/* Quick result entry for completed matches */}
                            {match.homeScore === null && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-neon border-neon/30 hover:bg-neon/10"
                                onClick={() => openResultEntry(match)}
                              >
                                <Swords size={12} />
                                Enter Match Result
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Result Entry Dialog */}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className={showPokemonData ? 'max-w-2xl' : 'max-w-sm'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords size={16} className="text-neon" />
              Enter Match Result
            </DialogTitle>
            <DialogDescription>
              {resultMatch && `${resultMatch.homeTeamId} vs ${resultMatch.awayTeamId} (Week ${resultMatch.week})`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  {resultMatch?.homeTeamId} (Home)
                </label>
                <NumberInput value={homeScore} onChange={setHomeScore} min={0} max={6} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  {resultMatch?.awayTeamId} (Away)
                </label>
                <NumberInput value={awayScore} onChange={setAwayScore} min={0} max={6} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Replay URL</label>
              <Input
                value={replayUrl}
                onChange={e => setReplayUrl(e.target.value)}
                placeholder="https://replay.pokemonshowdown.com/..."
                className="h-8 text-xs bg-surface-overlay"
              />
            </div>

            {/* Pokemon K/D toggle */}
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

            {/* Pokemon K/D entry */}
            {showPokemonData && resultMatch && (
              <div className="grid grid-cols-2 gap-4">
                <PokemonKDSection
                  label={`${resultMatch.homeTeamId} (Home)`}
                  entries={homePokemon}
                  onChange={setHomePokemon}
                />
                <PokemonKDSection
                  label={`${resultMatch.awayTeamId} (Away)`}
                  entries={awayPokemon}
                  onChange={setAwayPokemon}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResultOpen(false)}>Cancel</Button>
            <Button
              disabled={submitting}
              className="bg-neon text-surface-base hover:bg-neon/90"
              onClick={submitResult}
            >
              {submitting ? 'Saving...' : 'Save Result'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-Pokemon K/D entry section for one side of a match */
function PokemonKDSection({ label, entries, onChange }: {
  label: string;
  entries: { name: string; kills: number; deaths: number; teraUsed: boolean; teraType: string }[];
  onChange: (entries: { name: string; kills: number; deaths: number; teraUsed: boolean; teraType: string }[]) => void;
}) {
  function updateEntry(index: number, field: string, value: unknown) {
    const next = entries.map((e, i) => i === index ? { ...e, [field]: value } : e);
    onChange(next);
  }

  function addEntry() {
    onChange([...entries, { name: '', kills: 0, deaths: 0, teraUsed: false, teraType: '' }]);
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
