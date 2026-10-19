/** Confirm panel listing exactly what a save will add, change and revoke. */
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { ApiPinDefinition } from '@/lib/api';
import type { SheetDiff } from './use-awards-sheet';
import type { SheetLeague, SheetRow } from './types';

function label(leagues: SheetLeague[], teamId: string): string {
  for (const l of leagues) {
    const t = l.teams.find(x => x.id === teamId);
    if (t) return `${t.teamName} (${l.name})`;
  }
  return teamId;
}

const detail = (r: Pick<SheetRow, 'pokemon' | 'nickname' | 'matchId'>) =>
  [r.pokemon, r.nickname && `"${r.nickname}"`, r.matchId && 'match'].filter(Boolean).join(' - ');

export function DiffDialog({
  def, diff, leagues, archived, saving, onConfirm, onClose,
}: {
  def: ApiPinDefinition;
  diff: SheetDiff;
  leagues: SheetLeague[];
  archived: boolean;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const section = (title: string, tone: string, items: { key: string; text: string }[]) =>
    items.length > 0 && (
      <div>
        <div className={`mb-1 font-mono text-[10px] font-bold uppercase tracking-wider ${tone}`}>
          {title} ({items.length})
        </div>
        <ul className="space-y-0.5 text-xs">
          {items.map(i => <li key={i.key} className="truncate">{i.text}</li>)}
        </ul>
      </div>
    );
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save {def.name} awards</DialogTitle>
          <DialogDescription>
            Saved as drafts - only staff see them until the season is published.
            {archived && ' This season is archived; the save will override that guard.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {section('Add', 'text-win', diff.adds.map(r => ({
            key: `a${r.teamId}${r.matchId}`, text: `${label(leagues, r.teamId)} ${detail(r)}`,
          })))}
          {section('Change', 'text-amber-400', diff.updates.map(r => ({
            key: `u${r.teamId}${r.matchId}`, text: `${label(leagues, r.teamId)} ${detail(r)}`,
          })))}
          {section('Revoke', 'text-loss', diff.revokes.map(p => ({
            key: `r${p.id}`, text: `${label(leagues, p.teamId ?? '')} ${p.matchId ? '(match)' : ''}`,
          })))}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Back</Button>
          <Button size="sm" onClick={onConfirm} disabled={saving}>{saving ? 'Saving...' : 'Confirm save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
