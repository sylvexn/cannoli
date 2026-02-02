import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { User, KeyRound } from 'lucide-react';

export function UserSettingsPage() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-heading text-text-primary">Settings</h1>
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
