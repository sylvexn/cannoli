import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { User as UserIcon, Palette, Camera, X } from 'lucide-react';
import { UserAccentScope } from '@/components/user-accent-scope';
import { getErrorMessage } from '@/lib/errors';
import { buildUploadUrl } from '@/lib/api';
import {
  PROFILE_COLOR_SWATCHES,
  MAX_DISPLAY_NAME,
  MAX_BIO,
  MAX_AVATAR_BYTES,
} from '@/lib/constants';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type ColorSlot = 'primary' | 'secondary' | 'tertiary';

const SLOT_LABELS: Record<ColorSlot, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary',
};

function SlotChip({
  slot,
  label,
  value,
  active,
  onSelect,
}: {
  slot: ColorSlot;
  label: string;
  value: string | null;
  active: boolean;
  onSelect: (slot: ColorSlot) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(slot)}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
        active
          ? 'border-neon bg-neon/10 text-text-primary'
          : 'border-border-subtle text-text-muted hover:border-border-default hover:text-text-primary'
      }`}
    >
      <span
        className="inline-block h-3 w-3 rounded-full border border-border-subtle"
        style={{ backgroundColor: value ?? 'transparent' }}
      />
      <span>{label}</span>
      <span
        className={`text-xs leading-none ${active ? 'text-neon' : 'text-text-muted'}`}
        aria-hidden
      >
        {active ? '●' : '○'}
      </span>
    </button>
  );
}

function ColorPicker({
  values,
  onChange,
}: {
  values: Record<ColorSlot, string | null>;
  onChange: (slot: ColorSlot, value: string) => void;
}) {
  const [activeSlot, setActiveSlot] = useState<ColorSlot>('primary');
  const activeValue = values[activeSlot];
  const [draft, setDraft] = useState(activeValue || '');

  useEffect(() => {
    setDraft(activeValue || '');
  }, [activeValue, activeSlot]);

  function commit(v: string) {
    if (HEX_RE.test(v)) onChange(activeSlot, v);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(SLOT_LABELS) as ColorSlot[]).map(slot => (
          <SlotChip
            key={slot}
            slot={slot}
            label={SLOT_LABELS[slot]}
            value={values[slot]}
            active={activeSlot === slot}
            onSelect={setActiveSlot}
          />
        ))}
      </div>

      <div className="rounded-lg border border-border-subtle p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            Editing {SLOT_LABELS[activeSlot]}
          </span>
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={e => { if (e.key === 'Enter') commit(draft); }}
            className="w-24 h-7 text-[11px] font-mono"
            maxLength={7}
            aria-label={`${SLOT_LABELS[activeSlot]} hex value`}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROFILE_COLOR_SWATCHES.map(c => {
            const selected = activeValue === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => { setDraft(c); onChange(activeSlot, c); }}
                aria-label={`Set ${SLOT_LABELS[activeSlot]} to ${c}`}
                aria-pressed={selected}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  selected
                    ? 'border-text-primary scale-110'
                    : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AvatarTile({ avatarPath, primaryColor, secondaryColor, initial, onUpload, onRemove }: {
  avatarPath: string | null | undefined;
  primaryColor: string | null;
  secondaryColor: string | null;
  initial: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so same file can be re-picked
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('File must be an image'); return; }
    if (file.size > MAX_AVATAR_BYTES) { toast.error('File must be ≤ 512KB'); return; }
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }

  // Add a cache-buster so the browser re-fetches the freshly-uploaded image.
  const [cacheBust] = useState(() => Date.now());
  const src = avatarPath ? `${buildUploadUrl(avatarPath)}?t=${cacheBust}` : null;

  return (
    <div className="flex flex-col items-center gap-2 shrink-0">
      <div className="group relative w-20 h-20">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || removing}
          className="relative w-full h-full rounded-full overflow-hidden border-2 border-border-default hover:border-neon transition-colors"
          style={{
            backgroundColor: primaryColor ?? '#7dd3fc',
            boxShadow: `0 0 0 2px ${secondaryColor ?? '#a78bfa'}`,
          }}
          aria-label="Upload avatar"
        >
          {src ? (
            <img src={src} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-2xl font-bold text-white">
              {initial}
            </span>
          )}
          <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Camera size={20} className="text-white" />
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={handleFile}
          className="hidden"
        />
        {(uploading || removing) && (
          <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center text-[10px] text-white">
            …
          </div>
        )}
      </div>
      {avatarPath && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing || uploading}
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-loss transition-colors disabled:opacity-40"
          aria-label="Remove avatar"
        >
          <X size={11} />
          Remove
        </button>
      )}
    </div>
  );
}

export function ProfileTab() {
  const { user, refreshUser } = useAuth();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [primary, setPrimary] = useState<string | null>(user?.primaryColor ?? null);
  const [secondary, setSecondary] = useState<string | null>(user?.secondaryColor ?? null);
  const [tertiary, setTertiary] = useState<string | null>(user?.tertiaryColor ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
    setBio(user?.bio ?? '');
    setPrimary(user?.primaryColor ?? null);
    setSecondary(user?.secondaryColor ?? null);
    setTertiary(user?.tertiaryColor ?? null);
  }, [user?.displayName, user?.bio, user?.primaryColor, user?.secondaryColor, user?.tertiaryColor]);

  const dirty =
    displayName !== (user?.displayName ?? '') ||
    bio !== (user?.bio ?? '') ||
    primary !== (user?.primaryColor ?? null) ||
    secondary !== (user?.secondaryColor ?? null) ||
    tertiary !== (user?.tertiaryColor ?? null);

  async function save() {
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      if (displayName !== (user?.displayName ?? '') || bio !== (user?.bio ?? '')) {
        tasks.push(api.updateMe({
          displayName: displayName.trim() === '' ? null : displayName.trim(),
          bio: bio.trim() === '' ? null : bio,
        }));
      }
      const colorsChanged =
        primary !== (user?.primaryColor ?? null) ||
        secondary !== (user?.secondaryColor ?? null) ||
        tertiary !== (user?.tertiaryColor ?? null);
      if (colorsChanged) {
        tasks.push(api.updateMyColors({
          primaryColor: primary,
          secondaryColor: secondary,
          tertiaryColor: tertiary,
        }));
      }
      await Promise.all(tasks);
      await refreshUser();
      toast.success('Profile saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(file: File) {
    try {
      await api.uploadAvatar(file);
      await refreshUser();
      toast.success('Avatar updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    }
  }

  async function handleAvatarRemove() {
    try {
      await api.deleteAvatar();
      await refreshUser();
      toast.success('Avatar removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Remove failed'));
    }
  }

  const initial = (user?.displayName || user?.username || '?').charAt(0).toUpperCase();

  return (
    <div className="space-y-6">
      {/* Identity card: avatar + displayName + bio */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserIcon size={16} />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-5">
            <AvatarTile
              avatarPath={user?.avatarPath}
              primaryColor={primary}
              secondaryColor={secondary}
              initial={initial}
              onUpload={handleAvatarUpload}
              onRemove={handleAvatarRemove}
            />
            <div className="flex-1 min-w-0 space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="dn" className="text-xs text-text-muted">Display name</label>
                  <span className="text-[10px] text-text-muted tabular-nums">
                    {displayName.length}/{MAX_DISPLAY_NAME}
                  </span>
                </div>
                <Input
                  id="dn"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value.slice(0, MAX_DISPLAY_NAME))}
                  placeholder={user?.username ?? 'Display name'}
                />
                <p className="text-[11px] text-text-muted">
                  Shown instead of your username. Leave empty to use <code className="font-mono">@{user?.username}</code>.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label htmlFor="bio" className="text-xs text-text-muted">Bio</label>
              <span className={`text-[10px] tabular-nums ${bio.length > MAX_BIO ? 'text-loss' : 'text-text-muted'}`}>
                {bio.length}/{MAX_BIO}
              </span>
            </div>
            <Textarea
              id="bio"
              value={bio}
              onChange={e => setBio(e.target.value.slice(0, MAX_BIO))}
              rows={3}
              placeholder="A short blurb about you, your team, or your battling style."
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Colors card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette size={16} />
            Profile Colors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-text-muted">
            Used on your avatar, mention pills, and trade cards.
          </p>

          <ColorPicker
            values={{ primary, secondary, tertiary }}
            onChange={(slot, v) => {
              if (slot === 'primary') setPrimary(v);
              else if (slot === 'secondary') setSecondary(v);
              else setTertiary(v);
            }}
          />

          <UserAccentScope
            user={{ primaryColor: primary, secondaryColor: secondary, tertiaryColor: tertiary }}
            className="rounded-lg border border-border-subtle p-3 space-y-2"
          >
            <div className="text-[10px] uppercase tracking-wider text-text-muted">Preview</div>
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                style={{
                  backgroundColor: 'var(--user-primary)',
                  color: '#fff',
                  boxShadow: '0 0 0 2px var(--user-secondary)',
                }}
              >
                {initial}
              </div>
              <div
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  border: '1px solid var(--user-primary)',
                  color: 'var(--user-primary)',
                  backgroundColor: 'color-mix(in oklab, var(--user-primary) 10%, transparent)',
                }}
              >
                @{user?.username}
              </div>
              <span className="ml-auto inline-flex h-3 w-3 rounded" style={{ backgroundColor: 'var(--user-tertiary)' }} />
            </div>
          </UserAccentScope>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-surface-base/80 backdrop-blur-sm border-t border-border-subtle flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-text-muted">Unsaved changes</span>}
        <Button
          onClick={save}
          disabled={!dirty || saving}
          className="bg-neon text-surface-base hover:bg-neon/90 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
