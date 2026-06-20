/**
 * Admin Rules editor — structured, per-league.
 *
 * Pick a league, then edit every section of that league's rules document:
 * additional notes, draft/battle rule lists, named clauses, Pokémon-specific
 * bans, banned abilities/items/moves and tera-captain bans. The backend
 * resolves each league to a saved override OR its cost-format default, so the
 * editor always loads a complete document; saving creates/updates the override,
 * resetting deletes it (falling back to the format default).
 *
 * Dirty tracking is a JSON-equality compare against the loaded baseline. Saving
 * adopts the backend-normalized content as the new baseline. Switching leagues
 * while dirty is guarded by a confirm dialog.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import { useAppData } from '@/lib/app-data-context';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  emptyRules, type RulesContent, type LeagueRulesResponse,
} from '@/lib/rules-types';
import {
  StringListEditor, PairListEditor, ChipEditor, type PairItem,
} from './list-editors';
import {
  Save, Loader2, RotateCcw, FileDown, AlertTriangle, CheckCircle2, Pencil,
} from 'lucide-react';

const NOTES_MAX = 8_000;

/** A titled, bordered section block. */
function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-base/40 p-3 space-y-2.5">
      <div>
        <h3 className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-[10px] text-text-muted leading-relaxed">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** PairItem <-> domain conversions keep the generic PairListEditor reusable. */
const toClausePairs = (c: RulesContent['clauses']): PairItem[] =>
  c.map((x) => ({ a: x.name, b: x.description }));
const fromClausePairs = (p: PairItem[]): RulesContent['clauses'] =>
  p.map((x) => ({ name: x.a, description: x.b }));
const toBanPairs = (b: RulesContent['pokemonBans']): PairItem[] =>
  b.map((x) => ({ a: x.pokemon, b: x.move }));
const fromBanPairs = (p: PairItem[]): RulesContent['pokemonBans'] =>
  p.map((x) => ({ pokemon: x.a, move: x.b }));

export function AdminRules() {
  const { leagues } = useAppData();

  const [leagueId, setLeagueId] = useState<string>('');
  const [resp, setResp] = useState<LeagueRulesResponse | null>(null);
  const [content, setContent] = useState<RulesContent>(emptyRules());
  const [baseline, setBaseline] = useState<RulesContent>(emptyRules());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Pending league switch held behind the unsaved-changes guard dialog.
  const [pendingLeague, setPendingLeague] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Pick a sensible default league on first load.
  useEffect(() => {
    if (!leagueId && leagues.length > 0) setLeagueId(leagues[0].id);
  }, [leagues, leagueId]);

  // Load rules whenever the selected league changes. A ref guards against a
  // stale response clobbering a newer selection.
  const loadSeq = useRef(0);
  useEffect(() => {
    if (!leagueId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    api.getLeagueRules(leagueId)
      .then((r) => {
        if (seq !== loadSeq.current) return;
        setResp(r);
        setContent(r.content);
        setBaseline(r.content);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        toast.error(getErrorMessage(err) ?? 'Failed to load rules');
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  }, [leagueId]);

  const isDirty = useMemo(
    () => JSON.stringify(content) !== JSON.stringify(baseline),
    [content, baseline],
  );

  const league = useMemo(
    () => leagues.find((l) => l.id === leagueId),
    [leagues, leagueId],
  );

  function requestLeagueSwitch(next: string) {
    if (next === leagueId) return;
    if (isDirty) setPendingLeague(next);
    else setLeagueId(next);
  }

  function confirmSwitch() {
    if (pendingLeague) setLeagueId(pendingLeague);
    setPendingLeague(null);
  }

  async function handleSave() {
    if (!leagueId) return;
    setSaving(true);
    try {
      const r = await api.saveLeagueRules(leagueId, content);
      // Adopt the backend-normalized content as the new baseline + editor state.
      setContent(r.content);
      setBaseline(r.content);
      setResp((prev) =>
        prev ? { ...prev, content: r.content, isCustom: true, updatedAt: new Date().toISOString() } : prev,
      );
      toast.success('Rules saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!leagueId) return;
    setConfirmReset(false);
    setResetting(true);
    try {
      await api.resetLeagueRules(leagueId);
      // Refetch so we get the freshly-resolved format default + isCustom=false.
      const r = await api.getLeagueRules(leagueId);
      setResp(r);
      setContent(r.content);
      setBaseline(r.content);
      toast.success('Reset to format default');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err) ?? 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  function loadDefaultIntoEditor() {
    if (!resp) return;
    setContent(structuredClone(resp.defaults));
    toast.info('Loaded format default into editor (not yet saved)');
  }

  const busy = saving || resetting;

  if (leagues.length === 0) {
    return (
      <EmptyState
        variant="nothing-here"
        title="No leagues to configure."
        subtitle="Create a league first, then edit its rules here."
        spriteSize="md"
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* ── Toolbar: league picker + status + actions ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={leagueId} onValueChange={(v) => v && requestLeagueSwitch(v)}>
            <SelectTrigger className="w-[200px] h-8 text-xs bg-surface-overlay">
              <SelectValue placeholder="Select league" />
            </SelectTrigger>
            <SelectContent>
              {leagues.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: l.color }}
                    />
                    {l.name}
                    {l.costFormat && (
                      <span className="font-mono text-[9px] uppercase text-text-muted">
                        {l.costFormat}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadDefaultIntoEditor}
            disabled={busy || loading || !resp}
            className="h-7 gap-1.5 text-[11px] text-text-muted"
          >
            <FileDown size={13} />
            Load default
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmReset(true)}
            disabled={busy || loading || !resp?.isCustom}
            className="h-7 gap-1.5 text-[11px] text-text-muted hover:text-loss"
          >
            {resetting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Reset to default
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={busy || loading || !isDirty}
            className="h-7 gap-1.5 text-[11px] bg-neon text-surface-base hover:bg-neon/90"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {/* Status line */}
        {resp && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {resp.isCustom ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-neon/30 bg-neon/10 px-1.5 py-0.5 text-neon">
                <Pencil size={11} />
                Custom override
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-overlay px-1.5 py-0.5 text-text-muted">
                <CheckCircle2 size={11} />
                Using format default — saving creates an override
              </span>
            )}
            {resp.updatedAt && (
              <span className="text-text-muted">
                Updated {new Date(resp.updatedAt).toLocaleString()}
              </span>
            )}
            {isDirty && (
              <span className="inline-flex items-center gap-1 text-pink">
                <AlertTriangle size={11} />
                Unsaved changes
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      {loading ? (
        <LoadingSprite label="Loading rules..." />
      ) : (
        <div className="space-y-3">
          <Section
            title="Additional Notes"
            hint="Freeform prose shown at the top of the public /rules page. Newlines preserved."
          >
            <textarea
              value={content.notes}
              rows={6}
              maxLength={NOTES_MAX}
              placeholder="Season-specific notes, format clarifications, etc."
              onChange={(e) => setContent((c) => ({ ...c, notes: e.target.value }))}
              className={cn(
                'w-full rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm',
                'text-text-primary placeholder:text-text-muted leading-relaxed outline-none',
                'transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y',
              )}
              spellCheck
            />
            <div className="text-right text-[10px] font-mono tabular-nums text-text-muted">
              {content.notes.length}/{NOTES_MAX}
            </div>
          </Section>

          <Section title="Draft Rules" hint="Ordered list of draft-phase rules.">
            <StringListEditor
              items={content.draftRules}
              onChange={(v) => setContent((c) => ({ ...c, draftRules: v }))}
              placeholder="Describe a draft rule…"
              addLabel="Add draft rule"
            />
          </Section>

          <Section title="Battle Rules" hint="Ordered list of in-battle rules.">
            <StringListEditor
              items={content.battleRules}
              onChange={(v) => setContent((c) => ({ ...c, battleRules: v }))}
              placeholder="Describe a battle rule…"
              addLabel="Add battle rule"
            />
          </Section>

          <Section title="Clauses" hint="Named clauses (e.g. Sleep Clause) with a description.">
            <PairListEditor
              items={toClausePairs(content.clauses)}
              onChange={(p) => setContent((c) => ({ ...c, clauses: fromClausePairs(p) }))}
              labelA="Clause"
              labelB="Description"
              placeholderA="Sleep Clause"
              placeholderB="What the clause enforces…"
              addLabel="Add clause"
              bMultiline
            />
          </Section>

          <Section
            title="Pokémon-Specific Bans"
            hint="A Pokémon paired with a banned move (leave move blank for a full ban)."
          >
            <PairListEditor
              items={toBanPairs(content.pokemonBans)}
              onChange={(p) => setContent((c) => ({ ...c, pokemonBans: fromBanPairs(p) }))}
              labelA="Pokémon"
              labelB="Move"
              placeholderA="Pokémon name"
              placeholderB="Banned move"
              addLabel="Add Pokémon ban"
            />
          </Section>

          <Section title="Banned Abilities">
            <ChipEditor
              items={content.bannedAbilities}
              onChange={(v) => setContent((c) => ({ ...c, bannedAbilities: v }))}
              placeholder="Add an ability and press Enter…"
            />
          </Section>

          <Section title="Banned Items">
            <ChipEditor
              items={content.bannedItems}
              onChange={(v) => setContent((c) => ({ ...c, bannedItems: v }))}
              placeholder="Add an item and press Enter…"
            />
          </Section>

          <Section title="Banned Moves">
            <ChipEditor
              items={content.bannedMoves}
              onChange={(v) => setContent((c) => ({ ...c, bannedMoves: v }))}
              placeholder="Add a move and press Enter…"
            />
          </Section>

          <Section
            title="Tera Captain Bans"
            hint="Pokémon draftable but not eligible as a Tera Captain."
          >
            <ChipEditor
              items={content.teraCaptainBans}
              onChange={(v) => setContent((c) => ({ ...c, teraCaptainBans: v }))}
              placeholder="Add a Pokémon and press Enter…"
            />
          </Section>
        </div>
      )}

      {/* ── Unsaved-changes guard for league switch ── */}
      <Dialog open={pendingLeague !== null} onOpenChange={(o) => !o && setPendingLeague(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have unsaved edits to {league?.name ?? 'this league'}'s rules.
              Switching leagues will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingLeague(null)}>
              Keep editing
            </Button>
            <Button
              size="sm"
              onClick={confirmSwitch}
              className="bg-loss text-surface-base hover:bg-loss/90"
            >
              Discard & switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset confirmation ── */}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset to format default?</DialogTitle>
            <DialogDescription>
              This deletes {league?.name ?? 'this league'}'s saved override. The league
              will fall back to its cost-format default rules. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleReset}
              className="bg-loss text-surface-base hover:bg-loss/90"
            >
              Reset to default
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
