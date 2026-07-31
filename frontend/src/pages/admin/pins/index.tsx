/**
 * Single-tab redesigned Pins admin. Replaces the old Definitions/Award
 * tab pair with a season-scoped grid of pin cards plus a recent-awards
 * sidebar. Each card opens its own metadata-aware award dialog (driven by
 * `lib/pin-metadata-schema.tsx`); inline-edit lives in a popover on each
 * card. New definitions still use the legacy DefinitionDialog (kept in
 * `admin-pins.tsx`) via the "New Pin" button.
 *
 * Per-pin actions (post-WT-A):
 *   - Manual pin (isAuto = false) → "Award" button (opens metadata-aware
 *     dialog to pick recipient + leagueId/pokemon/nickname).
 *   - Auto pin (isAuto = true) already awarded for the active season →
 *     "Edit" button (opens dialog to re-point the pin to a different user).
 *   - Auto pin not yet awarded → no button; the auto job will handle it.
 *
 * The top-bar "Mint S{N} Auto-Awards" button re-runs the season-end auto
 * job (Garchomp / Cannoli / Cynthia / etc.) for every league in the season.
 * It is gated to seasons whose summary phase = `offseason` (i.e. every
 * league has wrapped) — mid-season clicks would clobber rows that the
 * per-match auto job is still maintaining — and confirms before running,
 * since it can rewrite an entire season's worth of auto pins.
 *
 * Base data (defs/users/leagues/seasons) and the recent-awards list load
 * independently via Promise.allSettled: one endpoint failing degrades that
 * section only, with an inline retry, instead of blanking the whole tab.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { Pin } from '@/components/pin';
import { Plus, Search, Sparkles, Trash2, AlertTriangle, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type {
  ApiPinDefinition, ApiPinRecent, ApiAuthUser, ApiLeague,
} from '@/lib/api';
import { formatPinMetadata } from '@/lib/pin-metadata-schema';
import { DefinitionCard } from './definition-card';
import { AwardDialog } from './award-dialog';
import { EditPinDialog } from './edit-pin-dialog';
import { UnresolvedPanel, type UnresolvedEntry } from './unresolved-panel';
import { NewDefinitionDialog } from '../admin-pins';

interface SeasonRow {
  id: number;
  seasonNumber: number;
  phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
}

const SECTION_LABEL = {
  defs: 'pin definitions',
  users: 'users',
  leagues: 'leagues',
  seasons: 'seasons',
} as const;

export function PinsTab() {
  const [defs, setDefs] = useState<ApiPinDefinition[]>([]);
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [leagues, setLeagues] = useState<ApiLeague[]>([]);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [recent, setRecent] = useState<ApiPinRecent[]>([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [baseErrors, setBaseErrors] = useState<string[]>([]);
  const [recentError, setRecentError] = useState(false);

  const [search, setSearch] = useState('');
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [awardDef, setAwardDef] = useState<ApiPinDefinition | null>(null);
  const [editPin, setEditPin] = useState<ApiPinRecent | null>(null);
  const [creating, setCreating] = useState(false);
  const [minting, setMinting] = useState(false);
  const [unresolved, setUnresolved] = useState<UnresolvedEntry[]>([]);

  // Base data — defs/users/leagues/seasons. Independent of season selection.
  const loadBase = useCallback(() => {
    setLoadingBase(true);
    Promise.allSettled([
      api.getPinDefinitions(),
      api.getUsers(),
      api.getLeagues(),
      api.getSeasons(),
    ]).then(([d, u, l, s]) => {
      const failed: string[] = [];
      if (d.status === 'fulfilled') setDefs(d.value); else failed.push(SECTION_LABEL.defs);
      if (u.status === 'fulfilled') setUsers(u.value); else failed.push(SECTION_LABEL.users);
      if (l.status === 'fulfilled') setLeagues(l.value); else failed.push(SECTION_LABEL.leagues);
      if (s.status === 'fulfilled') {
        setSeasons(s.value.map(row => ({ id: row.id, seasonNumber: row.seasonNumber, phase: row.phase })));
      } else {
        failed.push(SECTION_LABEL.seasons);
      }
      setBaseErrors(failed);
      setLoadingBase(false);
    });
  }, []);

  useEffect(() => { loadBase(); }, [loadBase]);

  // Default season: highest seasonNumber. Re-applied only on initial load —
  // user picks override stick.
  useEffect(() => {
    if (seasonId != null || seasons.length === 0) return;
    const highest = seasons.reduce((acc, s) => s.seasonNumber > acc.seasonNumber ? s : acc, seasons[0]);
    setSeasonId(highest.seasonNumber);
  }, [seasons, seasonId]);

  const filteredDefs = useMemo(() => {
    if (!search) return defs;
    const q = search.toLowerCase();
    return defs.filter(d =>
      d.id.includes(q) || d.name.toLowerCase().includes(q) || d.category.includes(q),
    );
  }, [defs, search]);

  // The tab tracks the season NUMBER (it drives the dropdown and the mint
  // endpoint, which both key off seasonNumber), but pins.season_id stores the
  // real season *id*. Resolve that id for anything that touches pin rows — the
  // award payload and the recent-pins fetch — otherwise awards land on a
  // nonexistent season (FK violation → 500).
  const activeSeason = useMemo(
    () => seasons.find(s => s.seasonNumber === seasonId) ?? null,
    [seasons, seasonId],
  );
  const activeSeasonId = activeSeason?.id ?? null;
  // Mint button visibility: only when all leagues for the active season have
  // wrapped (phase = offseason). The /api/seasons aggregate uses the
  // "least-advanced" phase across leagues, so offseason implies all leagues.
  const seasonOffseasonOrPast = activeSeason?.phase === 'offseason';
  const seasonNumberById = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of seasons) m.set(s.id, s.seasonNumber);
    return m;
  }, [seasons]);

  // Recent awards — server-filtered to the active season (falls back to
  // unfiltered "all seasons" when none is selected). Scoping server-side
  // means an older season's pins can't fall off the end of the 200-row cap
  // and silently lose their Edit affordance.
  const loadRecent = useCallback(() => {
    setLoadingRecent(true);
    setRecentError(false);
    api.getRecentPins(200, activeSeasonId ?? undefined)
      .then(setRecent)
      .catch(() => setRecentError(true))
      .finally(() => setLoadingRecent(false));
  }, [activeSeasonId]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Award counts + existing-award buckets — `recent` is already scoped to
  // the active season by the fetch above, so no client-side re-filter needed.
  const seasonAwardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of recent) counts[r.pinDefId] = (counts[r.pinDefId] ?? 0) + 1;
    return counts;
  }, [recent]);

  // Bucket existing pins per def so cards know whether to show Award
  // (manual + unawarded) or Edit (auto + already awarded).
  const existingByDef = useMemo(() => {
    const map = new Map<string, ApiPinRecent[]>();
    for (const r of recent) {
      const list = map.get(r.pinDefId) ?? [];
      list.push(r);
      map.set(r.pinDefId, list);
    }
    return map;
  }, [recent]);

  async function handleRunAuto() {
    if (seasonId == null) return;
    const confirmed = confirm(
      `Re-run auto-awards for S${seasonId}? This recomputes Garchomp, Cannoli, Cynthia, and the other stat-driven pins for every league in the season, and can overwrite existing auto-awarded pins.`,
    );
    if (!confirmed) return;
    setMinting(true);
    try {
      const r = await api.runSeasonAutoAwards(seasonId);
      setUnresolved(r.unresolved ?? []);
      if (r.totalAwarded === 0 && r.totalSkipped === 0 && (r.unresolved ?? []).length === 0) {
        toast.message(`No auto-awards minted for S${seasonId} (no eligible matches?)`);
      } else {
        toast.success(
          `Auto-awards: ${r.totalAwarded} new, ${r.totalSkipped} skipped` +
          ((r.unresolved ?? []).length > 0 ? ` — ${r.unresolved.length} unresolved (see below)` : ''),
        );
      }
      loadRecent();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mint failed';
      toast.error(msg);
    } finally {
      setMinting(false);
    }
  }

  async function handleRevoke(id: number) {
    if (!confirm('Revoke this pin?')) return;
    try {
      await api.revokePin(id);
      toast.success('Pin revoked');
      loadRecent();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      toast.error(msg);
    }
  }

  const seasonLabel = seasonId != null ? `S${seasonId}` : null;

  return (
    <div className="space-y-3">
      {/* ─── Top bar: season selector + bulk mint + search + new pin ───── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
          Season
          <select
            value={seasonId ?? ''}
            onChange={e => setSeasonId(e.target.value ? parseInt(e.target.value) : null)}
            className="h-7 rounded-md border border-border-default bg-surface-raised text-xs px-2"
          >
            <option value="">All seasons</option>
            {seasons
              .slice()
              .sort((a, b) => b.seasonNumber - a.seasonNumber)
              .map(s => (
                <option key={s.id} value={s.seasonNumber}>S{s.seasonNumber}</option>
              ))}
          </select>
        </label>

        {seasonId != null && seasonOffseasonOrPast && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={handleRunAuto}
            disabled={minting}
            title="Re-run the auto-award job (Garchomp, Cannoli, Cynthia, ...) for every league in this season"
          >
            <Sparkles size={11} />
            {minting ? 'Minting...' : `Mint S${seasonId} Auto-Awards`}
          </Button>
        )}

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search pins"
            className="pl-7 h-7 text-xs"
          />
        </div>

        <Button size="sm" onClick={() => setCreating(true)} className="h-7">
          <Plus size={12} />
          New Pin
        </Button>
      </div>

      {/* ─── Base-data load errors — per-section, with retry ───────────── */}
      {baseErrors.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-loss/40 bg-loss/5 px-3 py-2 text-[11px] text-loss">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={12} />
            Couldn&apos;t load: {baseErrors.join(', ')}.
          </span>
          <Button variant="ghost" size="sm" className="h-6 text-[11px] text-loss hover:text-loss" onClick={loadBase}>
            <RotateCw size={10} />
            Retry
          </Button>
        </div>
      )}

      {/* ─── Unresolved awards from the last mint ───────────────────────── */}
      <UnresolvedPanel entries={unresolved} defs={defs} onDismiss={() => setUnresolved([])} />

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        {/* ─── Pin grid ───────────────────────────────────────────────── */}
        <div>
          {loadingBase ? (
            <LoadingSprite size="md" padding="md" />
          ) : filteredDefs.length === 0 ? (
            <EmptyState
              variant="nothing-here"
              title="No pins match."
              spriteSize="md"
              padding="sm"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {filteredDefs.map(def => {
                const existing = existingByDef.get(def.id) ?? [];
                return (
                  <DefinitionCard
                    key={def.id}
                    def={def}
                    seasonAwardCount={seasonAwardCounts[def.id] ?? 0}
                    seasonLabel={seasonLabel}
                    existingAwards={existing}
                    onAward={() => setAwardDef(def)}
                    onEdit={(pin) => setEditPin(pin)}
                    onEdited={loadBase}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ─── Recent awards sidebar ──────────────────────────────────── */}
        <aside className="space-y-2 rounded-md border border-border-default bg-surface-raised/30 p-3 self-start">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider text-text-secondary">
              {seasonLabel ? `${seasonLabel} awards` : 'Recent awards'}
            </h3>
            <span className="text-[10px] font-mono text-text-muted tabular-nums">
              {recent.length}
            </span>
          </div>
          {recentError ? (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <span className="flex items-center gap-1.5 text-[11px] text-loss">
                <AlertTriangle size={12} />
                Couldn&apos;t load recent awards.
              </span>
              <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={loadRecent}>
                <RotateCw size={10} />
                Retry
              </Button>
            </div>
          ) : loadingRecent ? (
            <LoadingSprite size="sm" padding="sm" />
          ) : recent.length === 0 ? (
            <EmptyState
              variant="quiet"
              title="No pins awarded yet."
              spriteSize="md"
              padding="sm"
            />
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
              {recent.map(r => {
                const detail = formatPinMetadata(r.pinDefId, r.metadata, r.leagueId);
                return (
                  <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-overlay/50 transition-colors">
                    <Pin
                      def={{ id: r.pinDefId, name: r.defName, iconName: r.defIconName, color: r.defColor }}
                      size="sm"
                      noTooltip
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate">
                        <span style={{ color: r.defColor }}>{r.defName}</span>
                        <span className="text-text-muted"> → </span>
                        <span className="font-mono">{r.username}</span>
                      </div>
                      {detail != null && (
                        <div className="text-[11px] text-text-secondary truncate italic">{detail}</div>
                      )}
                      <div className="flex items-center gap-1 text-[10px] text-text-muted">
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1 py-px font-mono font-bold uppercase tracking-wider',
                            r.source === 'auto' ? 'bg-cyan-400/15 text-cyan-400' : 'bg-amber-400/15 text-amber-400',
                          )}
                        >
                          {r.source}
                        </span>
                        {r.seasonId != null && <span>Earned S{seasonNumberById.get(r.seasonId) ?? r.seasonId}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-text-muted hover:text-loss"
                      onClick={() => handleRevoke(r.id)}
                      title="Revoke"
                    >
                      <Trash2 size={11} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {/* ─── Per-pin award dialog ─────────────────────────────────────── */}
      {awardDef && (
        <AwardDialog
          def={awardDef}
          defaultSeasonId={activeSeasonId}
          users={users}
          leagues={leagues}
          onClose={() => setAwardDef(null)}
          onAwarded={loadRecent}
        />
      )}

      {/* ─── New-definition dialog (legacy, reused from admin-pins.tsx) ─ */}
      {creating && (
        <NewDefinitionDialog
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); loadBase(); }}
        />
      )}

      {/* ─── Edit dialog (override auto-awarded recipient) ────────────── */}
      {editPin && (
        <EditPinDialog
          pin={editPin}
          users={users}
          onClose={() => setEditPin(null)}
          onSaved={() => { setEditPin(null); loadRecent(); }}
        />
      )}
    </div>
  );
}
