/**
 * Awards Sheet - one screen per season for curating awards. Pick a pin at the
 * top; each league is a section with one row per team (or per qualifying
 * match). Engine suggestions are pre-shown and one click to accept. "Save"
 * writes unpublished drafts in one transactional POST; "Publish" makes the
 * season's awards public (no notifications).
 */
import { useState } from 'react';
import { Eye, RotateCcw, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSprite } from '@/components/loading-sprite';
import { Pin } from '@/components/pin';
import { api, type ApiPinDefinition } from '@/lib/api';
import { PIN_SCOPE_META } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { DiffDialog } from './diff-dialog';
import { LeagueSection } from './league-section';
import { useAwardsSheet } from './use-awards-sheet';

export interface SheetSeason { id: number; seasonNumber: number; archived: boolean }

export function AwardsSheet({
  season, defs, initialDefId, onChanged,
}: {
  season: SheetSeason;
  defs: ApiPinDefinition[];
  initialDefId?: string | null;
  onChanged: () => void;
}) {
  const [defId, setDefId] = useState<string | null>(initialDefId ?? defs[0]?.id ?? null);
  const sheet = useAwardsSheet(season.id, defId);
  const [showDiff, setShowDiff] = useState(false);
  const [publishing, setPublishing] = useState<{ leagueId: string | null } | null>(null);
  const def = defs.find(d => d.id === defId) ?? null;

  const perDef = new Map<string, number>();
  for (const p of sheet.pins) perDef.set(p.pinDefId, (perDef.get(p.pinDefId) ?? 0) + 1);

  async function confirmSave() {
    try {
      await sheet.save(season.archived);
      toast.success('Saved as drafts');
      setShowDiff(false);
      onChanged();
    } catch (e) {
      setShowDiff(false);
      toast.error(getErrorMessage(e, 'Some rows need attention'));
    }
  }

  async function confirmPublish() {
    if (!publishing) return;
    try {
      const r = await api.publishPins(
        { seasonId: season.id, leagueId: publishing.leagueId }, season.archived);
      toast.success(`Published ${r.count} award${r.count === 1 ? '' : 's'}`);
      setPublishing(null);
      await sheet.load();
      onChanged();
    } catch (e) {
      toast.error(getErrorMessage(e, 'Publish failed'));
    }
  }

  if (sheet.loading && sheet.leagues.length === 0) return <LoadingSprite size="md" padding="md" />;
  if (sheet.error) {
    return <div className="rounded-md border border-loss/40 bg-loss/5 p-3 text-xs text-loss">{sheet.error}</div>;
  }

  // Required inputs missing on a selected row blocks the save up front.
  const fields = def?.metadataFields ?? [];
  const incomplete = [...sheet.rows.values()].some(r =>
    (fields.includes('pokemon') && !r.pokemon) || (fields.includes('nickname') && !r.nickname?.trim()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Pin">
        {defs.map(d => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={d.id === defId}
            onClick={() => setDefId(d.id)}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
              d.id === defId ? 'border-neon/60 bg-neon/10' : 'border-border-default hover:bg-surface-overlay/40',
            )}
          >
            <Pin def={d} size="xs" noTooltip />
            <span>{d.name}</span>
            <span className="font-mono text-[10px] text-text-muted tabular-nums">{perDef.get(d.id) ?? 0}</span>
          </button>
        ))}
      </div>

      {def && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-default bg-surface-raised/40 px-3 py-2">
            <Pin def={def} size="sm" noTooltip />
            <div className="min-w-0 flex-1 basis-48">
              <div className="text-sm font-medium" style={{ color: def.color }}>{def.name}</div>
              <div className="truncate text-[11px] text-text-muted">
                {PIN_SCOPE_META[def.scope].hint}{def.description ? ` - ${def.description}` : ''}
              </div>
            </div>
            <Button
              variant="outline" size="sm" className="h-7 text-[11px]"
              onClick={sheet.acceptAll} disabled={sheet.defSuggestions.length === 0}
              title="Accept every suggestion that is not a tie"
            >
              <Sparkles size={11} />
              Accept suggestions
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-[11px]"
              onClick={sheet.revert} disabled={sheet.changeCount === 0}
            >
              <RotateCcw size={11} />
              Revert
            </Button>
            <Button
              size="sm" className="h-7 text-[11px]"
              onClick={() => setShowDiff(true)}
              disabled={sheet.changeCount === 0 || incomplete || sheet.saving}
              title={incomplete ? 'Fill in the required Pokemon / nickname first' : undefined}
            >
              <Save size={11} />
              Save {sheet.changeCount} change{sheet.changeCount === 1 ? '' : 's'}
            </Button>
          </div>

          <div className="space-y-3">
            {sheet.leagues.map(l => (
              <LeagueSection
                key={l.id}
                league={l}
                def={def}
                rows={sheet.rows}
                setRows={sheet.setRows}
                existing={sheet.existing}
                suggestions={sheet.defSuggestions}
                unresolved={sheet.defUnresolved}
                rowErrors={sheet.rowErrors}
                action={
                  <Button
                    variant="ghost" size="sm" className="h-6 text-[10px]"
                    onClick={() => setPublishing({ leagueId: l.id })}
                    title="Publish this league's awards"
                  >
                    <Eye size={10} />
                    Publish league
                  </Button>
                }
              />
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-default bg-surface-raised/40 px-3 py-2">
        <div className="flex-1 basis-48 text-[11px] text-text-secondary">
          <span className="font-mono font-bold tabular-nums">{sheet.draftCount}</span> draft award
          {sheet.draftCount === 1 ? '' : 's'} in S{season.seasonNumber} are visible to staff only.
        </div>
        <Button
          size="sm" className="h-7 text-[11px]"
          onClick={() => setPublishing({ leagueId: null })}
          disabled={sheet.draftCount === 0}
        >
          <Eye size={11} />
          Publish season awards
        </Button>
      </div>

      {showDiff && def && (
        <DiffDialog
          def={def}
          diff={sheet.diff}
          leagues={sheet.leagues}
          archived={season.archived}
          saving={sheet.saving}
          onConfirm={confirmSave}
          onClose={() => setShowDiff(false)}
        />
      )}

      {publishing && (
        <Dialog open onOpenChange={o => { if (!o) setPublishing(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Publish S{season.seasonNumber} awards{publishing.leagueId ? ` (${publishing.leagueId})` : ''}
              </DialogTitle>
              <DialogDescription>
                Every saved draft {publishing.leagueId ? 'in this league ' : ''}becomes public on team,
                coach and archive pages. No notifications are sent.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setPublishing(null)}>Cancel</Button>
              <Button size="sm" onClick={confirmPublish}>Publish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
