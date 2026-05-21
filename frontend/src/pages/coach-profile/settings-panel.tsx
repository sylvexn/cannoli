/**
 * In-place profile settings panel surfaced ON the coach profile page itself
 * (not in /settings) so the owner can edit bio / status / banner without
 * leaving the surface where the changes are visible. The /settings page
 * still owns avatar + colors + display name; this panel deliberately scopes
 * down to the new "personality" fields the surface pass introduced.
 */

import { useEffect, useRef, useState } from 'react';
import { Upload, X, Search } from 'lucide-react';
import { api, type ApiPublicProfile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { POKEMON_TYPES, spriteUrl, type PokemonType } from '@/lib/pokemon';
import { TYPE_COLORS, TYPE_LABELS } from '@/lib/constants';

const MAX_BIO = 280;
const MAX_STATUS = 80;
const MAX_TITLE = 40;

interface ProfileSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  profile: ApiPublicProfile;
  /** Called after a successful save so the parent can re-fetch fresh data. */
  onSaved: () => void | Promise<void>;
}

export function ProfileSettingsPanel({
  open, onClose, profile, onSaved,
}: ProfileSettingsPanelProps) {
  const [bio, setBio] = useState(profile.bio ?? '');
  const [statusMessage, setStatusMessage] = useState(profile.statusMessage ?? '');
  const [bannerPreview, setBannerPreview] = useState<string | null>(profile.bannerUrl ?? null);
  // ─── Coach flair state ──────────────────────────────────────────────────
  const [title, setTitle] = useState(profile.title ?? '');
  const [signatureType, setSignatureType] = useState<string | null>(profile.signatureType ?? null);
  const [signaturePokemonId, setSignaturePokemonId] = useState<number | null>(profile.signaturePokemonId ?? null);
  const [signaturePokemonName, setSignaturePokemonName] = useState<string | null>(profile.signaturePokemonName ?? null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Reset local state when the dialog re-opens against a fresh profile.
  useEffect(() => {
    if (!open) return;
    setBio(profile.bio ?? '');
    setStatusMessage(profile.statusMessage ?? '');
    setBannerPreview(profile.bannerUrl ?? null);
    setTitle(profile.title ?? '');
    setSignatureType(profile.signatureType ?? null);
    setSignaturePokemonId(profile.signaturePokemonId ?? null);
    setSignaturePokemonName(profile.signaturePokemonName ?? null);
  }, [
    open, profile.bio, profile.statusMessage, profile.bannerUrl,
    profile.title, profile.signatureType, profile.signaturePokemonId,
    profile.signaturePokemonName,
  ]);

  const dirty =
    bio !== (profile.bio ?? '') ||
    statusMessage !== (profile.statusMessage ?? '') ||
    title !== (profile.title ?? '') ||
    signatureType !== (profile.signatureType ?? null) ||
    signaturePokemonId !== (profile.signaturePokemonId ?? null);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateMe({
        bio: bio.trim() === '' ? null : bio,
        statusMessage: statusMessage.trim() === '' ? null : statusMessage.trim(),
        title: title.trim() === '' ? null : title.trim(),
        signatureType: signatureType ?? null,
        signaturePokemonId: signaturePokemonId ?? null,
      });
      await onSaved();
      toast.success('Profile saved');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleBannerFile(file: File) {
    setUploading(true);
    try {
      const res = await api.uploadUserBanner(file);
      setBannerPreview(res.path);
      await onSaved();
      toast.success('Banner updated');
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleClearBanner() {
    setUploading(true);
    try {
      await api.updateMe({ bannerUrl: null });
      setBannerPreview(null);
      await onSaved();
      toast.success('Banner cleared');
    } catch (err: any) {
      toast.error(err?.message || 'Clear failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono uppercase tracking-wider text-sm">
            <span className="text-neon">Edit</span>{' '}
            <span className="text-text-primary">Profile</span>
          </DialogTitle>
          <DialogDescription>
            Banner, status, and bio. Avatar and colors live in{' '}
            <span className="font-mono text-text-secondary">/settings</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Banner preview + upload */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Banner
            </label>
            <div className="relative h-24 w-full rounded-lg overflow-hidden border border-border-default bg-surface-overlay/30">
              {bannerPreview ? (
                <img
                  src={bannerPreview}
                  alt="Banner preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] font-mono text-text-muted">
                  Gradient fallback
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBannerFile(f);
                  e.target.value = '';
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload image'}
              </Button>
              {bannerPreview && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={handleClearBanner}
                >
                  <X size={12} />
                  Clear
                </Button>
              )}
              <span className="text-[10px] font-mono text-text-muted ml-auto">≤ 1 MB</span>
            </div>
          </div>

          {/* Status one-liner */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Status
              </label>
              <span className="text-[10px] font-mono tabular-nums text-text-muted">
                {statusMessage.length}/{MAX_STATUS}
              </span>
            </div>
            <input
              type="text"
              value={statusMessage}
              maxLength={MAX_STATUS}
              onChange={(e) => setStatusMessage(e.target.value)}
              placeholder="looking for water-types"
              className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
            />
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Bio
              </label>
              <span className="text-[10px] font-mono tabular-nums text-text-muted">
                {bio.length}/{MAX_BIO}
              </span>
            </div>
            <textarea
              value={bio}
              maxLength={MAX_BIO}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Anything you want fellow coaches to know."
              className="w-full px-3 py-2 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40 resize-y leading-snug"
            />
          </div>

          {/* ─── Coach flair section ─────────────────────────────────────── */}
          <div className="space-y-3 pt-3 border-t border-border-subtle/50">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Flair
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                  Title
                </label>
                <span className="text-[10px] font-mono tabular-nums text-text-muted">
                  {title.length}/{MAX_TITLE}
                </span>
              </div>
              <input
                type="text"
                value={title}
                maxLength={MAX_TITLE}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="The Garchomp Curse"
                className="w-full px-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
              />
            </div>

            {/* Signature type */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Signature type
              </label>
              <div className="flex flex-wrap gap-1">
                <TypeSwatch
                  type={null}
                  selected={signatureType === null}
                  onClick={() => setSignatureType(null)}
                />
                {POKEMON_TYPES.map((t) => (
                  <TypeSwatch
                    key={t}
                    type={t}
                    selected={signatureType === t}
                    onClick={() => setSignatureType(t)}
                  />
                ))}
              </div>
            </div>

            {/* Signature pokemon */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
                Signature Pokémon
              </label>
              <SignaturePokemonPicker
                currentId={signaturePokemonId}
                currentName={signaturePokemonName}
                onPick={(id, name) => {
                  setSignaturePokemonId(id);
                  setSignaturePokemonName(name);
                }}
                onClear={() => {
                  setSignaturePokemonId(null);
                  setSignaturePokemonName(null);
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

/** Single colored chip for the type selector. `type` of null renders the
 *  "no signature" choice as a quiet outlined dash. */
function TypeSwatch({
  type, selected, onClick,
}: { type: PokemonType | null; selected: boolean; onClick: () => void }) {
  if (type === null) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={
          'inline-flex items-center justify-center px-2 py-1 rounded text-[9px] font-mono font-bold uppercase tracking-wider transition-colors ' +
          (selected
            ? 'bg-neon/15 text-neon ring-1 ring-neon/40'
            : 'bg-surface-overlay/40 text-text-muted ring-1 ring-border-subtle hover:text-text-primary')
        }
        title="No signature type"
      >
        None
      </button>
    );
  }
  const color = TYPE_COLORS[type];
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center px-2 py-1 rounded text-[9px] font-mono font-bold uppercase tracking-wider transition-transform hover:scale-105"
      style={{
        backgroundColor: selected ? color : `${color}26`,
        color: selected ? '#0a0a14' : color,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${color}`,
      }}
      title={type}
    >
      {TYPE_LABELS[type]}
    </button>
  );
}

/** Search-driven picker for the signature Pokemon. Hits the existing
 *  `/api/pokemon` search endpoint (debounced) and renders a sprite preview
 *  on selection. Clears via the trailing X. */
function SignaturePokemonPicker({
  currentId, currentName, onPick, onClear,
}: {
  currentId: number | null;
  currentName: string | null;
  onPick: (id: number, name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: number; name: string; tier: number }>>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const list = await api.getPokemonList({ search: query, limit: 10 });
        setResults(list.map((p) => ({ id: p.id, name: p.name, tier: p.tier })));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer.current);
  }, [query]);

  function handlePick(id: number, name: string) {
    onPick(id, name);
    setQuery('');
    setResults([]);
  }

  return (
    <div className="space-y-2">
      {currentName ? (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border-default bg-surface-overlay/40">
          <img
            src={spriteUrl(currentName)}
            alt={currentName}
            className="w-7 h-7 shrink-0"
            style={{ imageRendering: 'pixelated' }}
            draggable={false}
          />
          <span className="text-sm text-text-primary truncate flex-1">{currentName}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-text-muted hover:text-red-400 transition-colors p-1 rounded"
            title="Clear signature"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={currentName ? 'Change…' : 'Search by name'}
          className="w-full pl-7 pr-3 py-1.5 rounded-md border border-border-default bg-surface-overlay/40 text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-neon/40"
        />
      </div>

      {(query.trim().length > 0) && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border-subtle bg-surface-overlay/30">
          {searching && results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] font-mono text-text-muted">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] font-mono text-text-muted">No matches</div>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(r.id, r.name)}
                    className={
                      'w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-neon/10 transition-colors ' +
                      (currentId === r.id ? 'bg-neon/5' : '')
                    }
                  >
                    <img
                      src={spriteUrl(r.name)}
                      alt=""
                      className="w-6 h-6 shrink-0"
                      style={{ imageRendering: 'pixelated' }}
                      draggable={false}
                    />
                    <span className="text-xs text-text-primary truncate flex-1">{r.name}</span>
                    <span className="text-[9px] font-mono text-text-muted">T{r.tier}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
