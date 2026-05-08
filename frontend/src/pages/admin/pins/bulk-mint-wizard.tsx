/**
 * Bulk season-mint wizard. Loads the hand-curated award list for a season
 * (S9 or S10 today; future seasons land in `lib/pins/awards-data.ts`),
 * shows it grouped by pin, and posts to /api/admin/pins/mint-season on
 * confirm.
 *
 * The minter on the backend is idempotent against the (user, def, season)
 * unique index, so re-running the wizard on a fully-seeded season is a
 * no-op — the summary will show `inserted: 0, skipped: N`.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { LoadingSprite } from '@/components/loading-sprite';
import { Pin } from '@/components/pin';
import { toast } from 'sonner';
import { api, type ApiManualAward, type ApiPinDefinition } from '@/lib/api';

interface BulkMintWizardProps {
  season: number;
  defs: ApiPinDefinition[];
  onClose: () => void;
  onMinted: () => void;
}

interface MintResult {
  inserted: number;
  skipped: number;
  unresolved: { award: ApiManualAward; reason: string }[];
}

export function BulkMintWizard({ season, defs, onClose, onMinted }: BulkMintWizardProps) {
  const [awards, setAwards] = useState<ApiManualAward[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MintResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.getManualAwards(season)
      .then(r => { if (!cancelled) setAwards(r.awards); })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to load award list';
        setLoadError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  // Group awards by pin id for a more readable preview. The order of
  // sections follows the order pins first appear in the list — matches the
  // way awards-data.ts is authored, which keeps related categories adjacent.
  const grouped = (() => {
    if (!awards) return [] as { pin: string; rows: ApiManualAward[] }[];
    const order: string[] = [];
    const buckets: Record<string, ApiManualAward[]> = {};
    for (const a of awards) {
      if (!buckets[a.pin]) { buckets[a.pin] = []; order.push(a.pin); }
      buckets[a.pin].push(a);
    }
    return order.map(p => ({ pin: p, rows: buckets[p] }));
  })();

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const r = await api.mintSeasonAwards(season);
      setResult({ inserted: r.inserted, skipped: r.skipped, unresolved: r.unresolved });
      if (r.unresolved.length > 0) {
        toast.warning(
          `Minted ${r.inserted}, skipped ${r.skipped}, ${r.unresolved.length} unresolved`,
        );
      } else {
        toast.success(`Minted ${r.inserted} (${r.skipped} already on file)`);
      }
      onMinted();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mint failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mint S{season} Awards</DialogTitle>
          <DialogDescription>
            Replays the hand-curated award list from <code className="font-mono text-[11px]">awards-data.ts</code>.
            Idempotent — re-running on a fully-seeded season is a no-op.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <LoadingSprite size="md" padding="md" />
        ) : loadError ? (
          <div className="text-xs text-loss">{loadError}</div>
        ) : !awards ? (
          <div className="text-xs text-text-muted">No award list available for this season.</div>
        ) : result ? (
          <MintResultView result={result} />
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            <div className="text-[11px] text-text-muted">
              Preview: {awards.length} awards across {grouped.length} pin types.
            </div>
            {grouped.map(g => {
              const def = defs.find(d => d.id === g.pin);
              return (
                <section key={g.pin} className="rounded-md border border-border-default bg-surface-base/40 p-2">
                  <header className="flex items-center gap-2 mb-1">
                    {def && <Pin def={def} size="sm" noTooltip />}
                    <div className="text-[12px] font-medium" style={{ color: def?.color }}>
                      {def?.name ?? g.pin}
                    </div>
                    <div className="text-[10px] font-mono text-text-muted">
                      ({g.rows.length})
                    </div>
                  </header>
                  <ul className="space-y-0.5">
                    {g.rows.map((a, i) => (
                      <li key={i} className="text-[11px] text-text-secondary flex items-center gap-2">
                        <span className="font-mono text-[10px] text-text-muted w-20 truncate">
                          {a.leagueId ?? '·'}
                        </span>
                        {a.username && <span className="font-mono">{a.username}</span>}
                        {a.pokemon && (
                          <span className="italic">
                            {a.pokemon}
                            {a.nickname && <> — “{a.nickname}”</>}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={onClose} size="sm">Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} size="sm" disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={loading || !!loadError || submitting} size="sm">
                {submitting ? 'Minting...' : `Confirm — mint ${awards?.length ?? 0}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MintResultView({ result }: { result: MintResult }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-border-default p-2">
          <div className="text-[10px] uppercase text-text-muted font-mono">Inserted</div>
          <div className="text-lg font-bold text-win">{result.inserted}</div>
        </div>
        <div className="rounded-md border border-border-default p-2">
          <div className="text-[10px] uppercase text-text-muted font-mono">Skipped</div>
          <div className="text-lg font-bold text-text-secondary">{result.skipped}</div>
        </div>
        <div className="rounded-md border border-border-default p-2">
          <div className="text-[10px] uppercase text-text-muted font-mono">Unresolved</div>
          <div className="text-lg font-bold text-loss">{result.unresolved.length}</div>
        </div>
      </div>
      {result.unresolved.length > 0 && (
        <div className="rounded-md border border-loss/30 bg-loss/5 p-2 max-h-48 overflow-y-auto">
          <div className="text-[11px] font-mono uppercase text-loss/80 mb-1">
            Could not resolve
          </div>
          <ul className="space-y-0.5">
            {result.unresolved.map((u, i) => (
              <li key={i} className="text-[11px] text-text-secondary">
                <span className="font-mono">{u.award.pin}</span>
                {u.award.leagueId && <> · {u.award.leagueId}</>}
                {u.award.username && <> · {u.award.username}</>}
                {u.award.pokemon && <> · {u.award.pokemon}</>}
                <span className="text-loss/70"> — {u.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
