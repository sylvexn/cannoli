import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { NeonLogo } from '@/components/neon-logo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function ChangePasswordPage() {
  const { user, isAuthenticated, changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const isForced = user?.mustChangePassword;
  const mismatch = confirmPassword !== '' && newPassword !== confirmPassword;
  const tooShort = newPassword !== '' && newPassword.length < 6;

  async function handleSubmit(e: React.FormEvent) {
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
      navigate('/');
    } else {
      setError(result.error ?? 'Failed to change password');
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-center">
          <NeonLogo className="w-64 h-auto" />
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-text-primary font-heading">
            Change Password
          </h1>
          {isForced && (
            <p className="text-sm text-draw">
              First login — please set a new password.
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="current" className="text-sm text-text-secondary">
              Current Password
            </label>
            <Input
              id="current"
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="new" className="text-sm text-text-secondary">
              New Password
            </label>
            <Input
              id="new"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={tooShort || undefined}
            />
            {tooShort && (
              <p className="text-xs text-loss">At least 6 characters</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm text-text-secondary">
              Confirm Password
            </label>
            <Input
              id="confirm"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch || undefined}
            />
            {mismatch && (
              <p className="text-xs text-loss">Passwords do not match</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-loss">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !currentPassword || !newPassword || !confirmPassword || mismatch || tooShort}
            className="w-full bg-neon text-surface-base hover:bg-neon/90"
          >
            {loading ? 'Changing...' : 'Change Password'}
          </Button>

          {!isForced && (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="w-full text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
