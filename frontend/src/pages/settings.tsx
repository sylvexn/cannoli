import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { User, KeyRound, Palette } from 'lucide-react';
import { UserAccentScope } from '@/components/user-accent-scope';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const SWATCHES = [
  '#7dd3fc', '#a78bfa', '#fb7185', // sky / violet / rose (defaults)
  '#22d3ee', '#34d399', '#facc15',
  '#fb923c', '#f43f5e', '#ec4899',
  '#8b5cf6', '#3b82f6', '#10b981',
  '#eab308', '#f97316', '#ef4444',
];

function ColorField({
  label, value, onChange,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { setDraft(value || ''); }, [value]);

  function commit(v: string) {
    if (HEX_RE.test(v)) onChange(v);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-muted">{label}</label>
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={e => { if (e.key === 'Enter') commit(draft); }}
          className="w-24 h-7 text-[11px] font-mono"
          maxLength={7}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map(c => (
          <button
            key={c}
            onClick={() => { setDraft(c); onChange(c); }}
            aria-label={`Set ${label} to ${c}`}
            className={`w-6 h-6 rounded-full border-2 transition-transform ${value === c ? 'border-text-primary scale-110' : 'border-transparent hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function UserSettingsPage() {
  const { user, changePassword, refreshUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Profile colors — local optimistic state
  const [primary, setPrimary] = useState<string | null>(user?.primaryColor ?? null);
  const [secondary, setSecondary] = useState<string | null>(user?.secondaryColor ?? null);
  const [tertiary, setTertiary] = useState<string | null>(user?.tertiaryColor ?? null);
  const [savingColors, setSavingColors] = useState(false);

  useEffect(() => {
    setPrimary(user?.primaryColor ?? null);
    setSecondary(user?.secondaryColor ?? null);
    setTertiary(user?.tertiaryColor ?? null);
  }, [user?.primaryColor, user?.secondaryColor, user?.tertiaryColor]);

  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;
  const tooShort = newPassword !== '' && newPassword.length < 6;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setError('');
    setLoading(true);
    const result = await changePassword(currentPassword, newPassword);
    setLoading(false);
    if (result.success) {
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setError(result.error ?? 'Failed to change password');
    }
  }

  async function saveColors() {
    setSavingColors(true);
    try {
      await api.updateMyColors({
        primaryColor: primary,
        secondaryColor: secondary,
        tertiaryColor: tertiary,
      });
      toast.success('Profile colors saved');
      await refreshUser();
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setSavingColors(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-tight uppercase text-text-primary">Settings</h1>
        <p className="text-sm text-text-muted">Manage your account</p>
      </div>

      <div className="grid gap-6 max-w-lg">
        {/* Account Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User size={16} />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Username</label>
              <Input value={user?.username ?? ''} disabled />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">Role</label>
              <Badge variant={user?.role === 'admin' ? 'default' : 'outline'}>
                {user?.role}
              </Badge>
            </div>
            <div className="text-xs text-text-muted">
              Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
            </div>
          </CardContent>
        </Card>

        {/* Profile colors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette size={16} />
              Profile Colors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-text-muted">
              These accents appear on your avatar, mention pills, and trade cards. Hex values like <code className="font-mono">#7dd3fc</code>.
            </p>
            <ColorField label="Primary" value={primary} onChange={setPrimary} />
            <ColorField label="Secondary" value={secondary} onChange={setSecondary} />
            <ColorField label="Tertiary" value={tertiary} onChange={setTertiary} />

            {/* Live preview */}
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
                  {(user?.username ?? '?').charAt(0).toUpperCase()}
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

            <div className="flex justify-end">
              <Button
                onClick={saveColors}
                disabled={savingColors}
                className="bg-neon text-surface-base hover:bg-neon/90"
              >
                {savingColors ? 'Saving…' : 'Save colors'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound size={16} />
              Change Password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="settings-current" className="text-xs text-text-muted">Current Password</label>
                <Input
                  id="settings-current"
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-new" className="text-xs text-text-muted">New Password</label>
                <Input
                  id="settings-new"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={tooShort || undefined}
                />
                {tooShort && <p className="text-xs text-loss">At least 6 characters</p>}
              </div>
              <div className="space-y-1">
                <label htmlFor="settings-confirm" className="text-xs text-text-muted">Confirm Password</label>
                <Input
                  id="settings-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={mismatch || undefined}
                />
                {mismatch && <p className="text-xs text-loss">Passwords do not match</p>}
              </div>
              {error && <p className="text-sm text-loss">{error}</p>}
              <Button
                type="submit"
                disabled={loading || !currentPassword || !newPassword || !confirmPassword || mismatch || tooShort}
                className="bg-neon text-surface-base hover:bg-neon/90"
              >
                {loading ? 'Changing...' : 'Change Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
