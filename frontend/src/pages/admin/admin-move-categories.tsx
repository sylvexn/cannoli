import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DEFAULT_MOVE_CATEGORIES,
  type MoveCategory,
  type MoveCategoryEntry,
} from '@/data/move-categories';
import {
  Plus, MoreHorizontal, ChevronRight, Pencil, Trash2,
  Zap, Dna, RotateCcw, X,
} from 'lucide-react';
import { toast } from 'sonner';

export function AdminMoveCategories() {
  const [categories, setCategories] = useState<MoveCategory[]>(
    () => DEFAULT_MOVE_CATEGORIES.map(c => ({ ...c, entries: [...c.entries] }))
  );
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // Category edit dialog
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');

  // Entry edit dialog
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [editEntryCatId, setEditEntryCatId] = useState<string | null>(null);
  const [editEntryIdx, setEditEntryIdx] = useState<number | null>(null);
  const [entryName, setEntryName] = useState('');
  const [entryIsAbility, setEntryIsAbility] = useState(false);

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ catId: string; entryIdx?: number } | null>(null);

  function toggleOpen(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Category CRUD
  function openNewCategory() {
    setEditCatId(null);
    setEditCatName('');
    setEditCatOpen(true);
  }

  function openEditCategory(cat: MoveCategory) {
    setEditCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatOpen(true);
  }

  function saveCategory() {
    const name = editCatName.trim();
    if (!name) return;

    if (editCatId) {
      setCategories(prev => prev.map(c =>
        c.id === editCatId ? { ...c, name } : c
      ));
      toast.success(`Renamed category to "${name}"`);
    } else {
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (categories.some(c => c.id === id)) {
        toast.error('A category with this name already exists');
        return;
      }
      setCategories(prev => [...prev, { id, name, entries: [] }]);
      setOpenIds(prev => new Set(prev).add(id));
      toast.success(`Created category "${name}"`);
    }
    setEditCatOpen(false);
  }

  function confirmDeleteCategory(catId: string) {
    setDeleteTarget({ catId });
    setDeleteOpen(true);
  }

  function confirmDeleteEntry(catId: string, entryIdx: number) {
    setDeleteTarget({ catId, entryIdx });
    setDeleteOpen(true);
  }

  function executeDelete() {
    if (!deleteTarget) return;
    const { catId, entryIdx } = deleteTarget;

    if (entryIdx === undefined) {
      const cat = categories.find(c => c.id === catId);
      setCategories(prev => prev.filter(c => c.id !== catId));
      toast.success(`Deleted category "${cat?.name}"`);
    } else {
      setCategories(prev => prev.map(c => {
        if (c.id !== catId) return c;
        const entries = [...c.entries];
        const removed = entries.splice(entryIdx, 1)[0];
        toast.success(`Removed "${removed.name}" from ${c.name}`);
        return { ...c, entries };
      }));
    }
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  // Entry CRUD
  function openNewEntry(catId: string) {
    setEditEntryCatId(catId);
    setEditEntryIdx(null);
    setEntryName('');
    setEntryIsAbility(false);
    setEditEntryOpen(true);
  }

  function openEditEntry(catId: string, idx: number, entry: MoveCategoryEntry) {
    setEditEntryCatId(catId);
    setEditEntryIdx(idx);
    setEntryName(entry.name);
    setEntryIsAbility(entry.isAbility ?? false);
    setEditEntryOpen(true);
  }

  function saveEntry() {
    const name = entryName.trim();
    if (!name || !editEntryCatId) return;

    const moveId = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const entry: MoveCategoryEntry = {
      name,
      moveId,
      ...(entryIsAbility ? { isAbility: true } : {}),
    };

    setCategories(prev => prev.map(c => {
      if (c.id !== editEntryCatId) return c;
      const entries = [...c.entries];
      if (editEntryIdx !== null) {
        entries[editEntryIdx] = entry;
        toast.success(`Updated "${name}"`);
      } else {
        if (entries.some(e => e.moveId === moveId)) {
          toast.error(`"${name}" already exists in this category`);
          return c;
        }
        entries.push(entry);
        toast.success(`Added "${name}" to ${c.name}`);
      }
      return { ...c, entries };
    }));
    setEditEntryOpen(false);
  }

  function resetToDefaults() {
    setCategories(DEFAULT_MOVE_CATEGORIES.map(c => ({ ...c, entries: [...c.entries] })));
    setOpenIds(new Set());
    toast.success('Reset to default categories');
  }

  const totalEntries = categories.reduce((sum, c) => sum + c.entries.length, 0);
  const abilityCount = categories.reduce(
    (sum, c) => sum + c.entries.filter(e => e.isAbility).length, 0
  );

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex gap-4 text-sm items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Categories:</span>
          <span className="text-text-primary font-medium font-mono">{categories.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Entries:</span>
          <span className="text-text-primary font-medium font-mono">{totalEntries}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Abilities:</span>
          <span className="text-purple-400 font-medium font-mono">{abilityCount}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefaults} className="text-text-muted">
            <RotateCcw size={12} />
            Reset Defaults
          </Button>
          <Button size="sm" onClick={openNewCategory} className="bg-neon text-surface-base hover:bg-neon/90">
            <Plus size={14} />
            New Category
          </Button>
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {categories.map(cat => {
          const isOpen = openIds.has(cat.id);
          const moveCount = cat.entries.filter(e => !e.isAbility).length;
          const abCount = cat.entries.filter(e => e.isAbility).length;

          return (
            <Collapsible key={cat.id} open={isOpen} onOpenChange={() => toggleOpen(cat.id)}>
              <Card>
                <CollapsibleTrigger className="flex items-center gap-3 px-4 py-2.5 w-full cursor-pointer hover:bg-surface-overlay/50 transition-colors text-left">
                    <ChevronRight
                      size={14}
                      className={`text-text-muted shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                    <span className="font-medium text-text-primary text-sm">{cat.name}</span>
                    <div className="flex gap-1.5 ml-1">
                      {moveCount > 0 && (
                        <Badge variant="outline" className="text-[10px] border-neon/30 text-neon bg-neon/10 px-1.5">
                          {moveCount} moves
                        </Badge>
                      )}
                      {abCount > 0 && (
                        <Badge variant="outline" className="text-[10px] border-purple-400/30 text-purple-400 bg-purple-400/10 px-1.5">
                          {abCount} abilities
                        </Badge>
                      )}
                    </div>
                    <div className="ml-auto" onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="p-1 rounded hover:bg-surface-overlay transition-colors outline-none">
                          <MoreHorizontal size={14} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditCategory(cat)}>
                            <Pencil size={14} /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openNewEntry(cat.id)}>
                            <Plus size={14} /> Add Entry
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => confirmDeleteCategory(cat.id)}>
                            <Trash2 size={14} /> Delete Category
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 pb-3 px-4">
                    {cat.entries.length === 0 ? (
                      <div className="text-sm text-text-muted py-2 pl-7">
                        No entries — <button className="text-neon hover:underline" onClick={() => openNewEntry(cat.id)}>add one</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pl-7">
                        {cat.entries.map((entry, idx) => (
                          <button
                            key={`${entry.moveId}-${idx}`}
                            onClick={() => openEditEntry(cat.id, idx, entry)}
                            className="group/entry flex items-center gap-1 px-2 py-1 rounded-md text-xs
                              bg-surface-overlay/50 hover:bg-surface-overlay transition-colors
                              border border-transparent hover:border-border"
                          >
                            {entry.isAbility ? (
                              <Dna size={10} className="text-purple-400 shrink-0" />
                            ) : (
                              <Zap size={10} className="text-neon shrink-0" />
                            )}
                            <span className="text-text-secondary group-hover/entry:text-text-primary transition-colors">
                              {entry.name}
                            </span>
                            <X
                              size={10}
                              className="text-text-muted opacity-0 group-hover/entry:opacity-100 transition-opacity ml-0.5 hover:text-loss"
                              onClick={e => { e.stopPropagation(); confirmDeleteEntry(cat.id, idx); }}
                            />
                          </button>
                        ))}
                        <button
                          onClick={() => openNewEntry(cat.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs
                            border border-dashed border-border hover:border-neon/50 text-text-muted hover:text-neon transition-colors"
                        >
                          <Plus size={10} />
                          Add
                        </button>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>

      {/* Edit Category Dialog */}
      <Dialog open={editCatOpen} onOpenChange={setEditCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editCatId ? 'Rename Category' : 'New Category'}</DialogTitle>
            <DialogDescription>
              {editCatId ? 'Update the category name.' : 'Create a new move/ability category for matchup analysis.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Category Name</label>
            <Input
              value={editCatName}
              onChange={e => setEditCatName(e.target.value)}
              placeholder="e.g. Hazards, Priority, Weather"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && saveCategory()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCatOpen(false)}>Cancel</Button>
            <Button
              onClick={saveCategory}
              disabled={!editCatName.trim()}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              {editCatId ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Entry Dialog */}
      <Dialog open={editEntryOpen} onOpenChange={setEditEntryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editEntryIdx !== null ? 'Edit Entry' : 'Add Entry'}</DialogTitle>
            <DialogDescription>
              Add a move or ability to this category. Moves are checked against learnset data; abilities are checked against Pokemon abilities.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Name</label>
              <Input
                value={entryName}
                onChange={e => setEntryName(e.target.value)}
                placeholder="e.g. Stealth Rock, Drought"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && saveEntry()}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Type</label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={!entryIsAbility ? 'default' : 'outline'}
                  onClick={() => setEntryIsAbility(false)}
                  className={!entryIsAbility ? 'bg-neon text-surface-base' : undefined}
                >
                  <Zap size={12} />
                  Move
                </Button>
                <Button
                  size="sm"
                  variant={entryIsAbility ? 'default' : 'outline'}
                  onClick={() => setEntryIsAbility(true)}
                  className={entryIsAbility ? 'bg-purple-500 text-white' : undefined}
                >
                  <Dna size={12} />
                  Ability
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEntryOpen(false)}>Cancel</Button>
            <Button
              onClick={saveEntry}
              disabled={!entryName.trim()}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              {editEntryIdx !== null ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              {deleteTarget?.entryIdx === undefined
                ? 'This will delete the entire category and all its entries. This cannot be undone.'
                : 'This will remove the entry from the category.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={executeDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
