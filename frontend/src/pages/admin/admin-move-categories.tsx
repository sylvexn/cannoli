import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible, CollapsibleContent,
} from '@/components/ui/collapsible';
import { api, type ApiMoveCategory, type ApiMoveCategoryEntry } from '@/lib/api';
import {
  Plus, MoreHorizontal, ChevronRight, Pencil, Trash2,
  Zap, Dna, X, Loader2, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { CategoryEditDialog } from './move-categories/category-edit-dialog';
import { EntryEditDialog } from './move-categories/entry-edit-dialog';
import { DeleteDialog } from './move-categories/delete-dialog';
import { getErrorMessage } from '@/lib/errors';

export function AdminMoveCategories() {
  const [categories, setCategories] = useState<ApiMoveCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [entrySearch, setEntrySearch] = useState('');

  // Category edit dialog
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');

  // Entry edit dialog
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [editEntryCatId, setEditEntryCatId] = useState<string | null>(null);
  const [editEntryIdx, setEditEntryIdx] = useState<number | null>(null);
  const [editEntryId, setEditEntryId] = useState<number | null>(null);
  const [entryName, setEntryName] = useState('');
  const [entryIsAbility, setEntryIsAbility] = useState(false);

  // Delete confirmation
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ catId: string; entryId?: number; entryIdx?: number } | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.getMoveCategories();
      setCategories(data);
    } catch {
      toast.error('Failed to load move categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

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

  function openEditCategory(cat: ApiMoveCategory) {
    setEditCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatOpen(true);
  }

  async function saveCategory() {
    const name = editCatName.trim();
    if (!name) return;

    try {
      if (editCatId) {
        await api.updateMoveCategory(editCatId, name);
        setCategories(prev => prev.map(c =>
          c.id === editCatId ? { ...c, name } : c
        ));
        toast.success(`Renamed category to "${name}"`);
      } else {
        const result = await api.createMoveCategory(name);
        setCategories(prev => [...prev, { id: result.id, name: result.name, entries: [] }]);
        setOpenIds(prev => new Set(prev).add(result.id));
        toast.success(`Created category "${name}"`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save category'));
    }
    setEditCatOpen(false);
  }

  function confirmDeleteCategory(catId: string) {
    setDeleteTarget({ catId });
    setDeleteOpen(true);
  }

  function confirmDeleteEntry(catId: string, entryId: number, entryIdx: number) {
    setDeleteTarget({ catId, entryId, entryIdx });
    setDeleteOpen(true);
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    const { catId, entryId } = deleteTarget;

    try {
      if (entryId === undefined) {
        // Delete whole category
        await api.deleteMoveCategory(catId);
        const cat = categories.find(c => c.id === catId);
        setCategories(prev => prev.filter(c => c.id !== catId));
        toast.success(`Deleted category "${cat?.name}"`);
      } else {
        // Delete entry
        await api.deleteMoveCategoryEntry(entryId);
        setCategories(prev => prev.map(c => {
          if (c.id !== catId) return c;
          const entries = c.entries.filter(e => e.id !== entryId);
          const removed = c.entries.find(e => e.id === entryId);
          toast.success(`Removed "${removed?.name}" from ${c.name}`);
          return { ...c, entries };
        }));
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete'));
    }
    setDeleteOpen(false);
    setDeleteTarget(null);
  }

  // Entry CRUD
  function openNewEntry(catId: string) {
    setEditEntryCatId(catId);
    setEditEntryIdx(null);
    setEditEntryId(null);
    setEntryName('');
    setEntryIsAbility(false);
    setEditEntryOpen(true);
  }

  function openEditEntry(catId: string, idx: number, entry: ApiMoveCategoryEntry) {
    setEditEntryCatId(catId);
    setEditEntryIdx(idx);
    setEditEntryId(entry.id);
    setEntryName(entry.name);
    setEntryIsAbility(entry.isAbility ?? false);
    setEditEntryOpen(true);
  }

  async function saveEntry() {
    const name = entryName.trim();
    if (!name || !editEntryCatId) return;

    try {
      if (editEntryIdx !== null && editEntryId !== null) {
        // In-place update — preserves entry id
        await api.updateMoveCategoryEntry(editEntryId, { name, isAbility: entryIsAbility });
        setCategories(prev => prev.map(c => {
          if (c.id !== editEntryCatId) return c;
          return {
            ...c,
            entries: c.entries.map(e =>
              e.id === editEntryId ? { ...e, name, isAbility: entryIsAbility } : e
            ),
          };
        }));
        toast.success(`Updated "${name}"`);
      } else {
        const result = await api.addMoveCategoryEntry(editEntryCatId, name, entryIsAbility || undefined);
        setCategories(prev => prev.map(c => {
          if (c.id !== editEntryCatId) return c;
          return {
            ...c,
            entries: [
              ...c.entries,
              { id: result.id, name, moveId: name.toLowerCase().replace(/[^a-z0-9]/g, ''), isAbility: entryIsAbility },
            ],
          };
        }));
        toast.success(`Added "${name}"`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save entry'));
    }
    setEditEntryOpen(false);
  }

  const totalEntries = categories.reduce((sum, c) => sum + c.entries.length, 0);
  const abilityCount = categories.reduce(
    (sum, c) => sum + c.entries.filter(e => e.isAbility).length, 0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted gap-2">
        <Loader2 size={16} className="animate-spin" />
        Loading move categories...
      </div>
    );
  }

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
        <div className="relative ml-2 w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={entrySearch}
            onChange={e => setEntrySearch(e.target.value)}
            placeholder="Search moves/abilities..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-surface text-xs border border-border-subtle focus:border-neon/40 focus:outline-none"
          />
          {entrySearch && (
            <button
              onClick={() => setEntrySearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={10} />
            </button>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={openNewCategory} className="bg-neon text-surface-base hover:bg-neon/90">
            <Plus size={14} />
            New Category
          </Button>
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {categories.map(cat => {
          const searchQ = entrySearch.toLowerCase();
          const matchingEntries = searchQ
            ? cat.entries.filter(e => e.name.toLowerCase().includes(searchQ))
            : cat.entries;
          // Hide categories with no matching entries when searching
          if (searchQ && matchingEntries.length === 0) return null;
          const isOpen = searchQ ? true : openIds.has(cat.id);
          const moveCount = cat.entries.filter(e => !e.isAbility).length;
          const abCount = cat.entries.filter(e => e.isAbility).length;

          return (
            <Collapsible key={cat.id} open={isOpen} onOpenChange={() => toggleOpen(cat.id)}>
              <Card>
                <div
                  className="flex items-center gap-3 px-4 py-2.5 w-full cursor-pointer hover:bg-surface-overlay/50 transition-colors text-left"
                  onClick={() => toggleOpen(cat.id)}
                >
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
                </div>

                <CollapsibleContent>
                  <CardContent className="pt-0 pb-3 px-4">
                    {cat.entries.length === 0 ? (
                      <div className="text-sm text-text-muted py-2 pl-7">
                        No entries — <button className="text-neon hover:underline" onClick={() => openNewEntry(cat.id)}>add one</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pl-7">
                        {cat.entries.map((entry, idx) => {
                          const isMatch = !searchQ || entry.name.toLowerCase().includes(searchQ);
                          return (
                          <button
                            key={`${entry.id}`}
                            onClick={() => openEditEntry(cat.id, idx, entry)}
                            className={`group/entry flex items-center gap-1 px-2 py-1 rounded-md text-xs
                              bg-surface-overlay/50 hover:bg-surface-overlay transition-colors
                              border border-transparent hover:border-border
                              ${searchQ && !isMatch ? 'opacity-20' : ''}
                              ${searchQ && isMatch ? 'ring-1 ring-neon/30' : ''}`}
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
                              onClick={e => { e.stopPropagation(); confirmDeleteEntry(cat.id, entry.id, idx); }}
                            />
                          </button>
                          );
                        })}
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

      {/* Dialogs */}
      <CategoryEditDialog
        open={editCatOpen}
        onOpenChange={setEditCatOpen}
        editCatId={editCatId}
        editCatName={editCatName}
        onEditCatNameChange={setEditCatName}
        onSave={saveCategory}
      />

      <EntryEditDialog
        open={editEntryOpen}
        onOpenChange={setEditEntryOpen}
        editEntryIdx={editEntryIdx}
        entryName={entryName}
        onEntryNameChange={setEntryName}
        entryIsAbility={entryIsAbility}
        onEntryIsAbilityChange={setEntryIsAbility}
        onSave={saveEntry}
      />

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        isEntryDelete={deleteTarget?.entryId !== undefined}
        onConfirm={executeDelete}
      />
    </div>
  );
}
