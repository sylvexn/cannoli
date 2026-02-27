import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { NeonLogo } from '@/components/neon-logo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already logged in
  if (isAuthenticated && user) {
    return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (result.success) {
      navigate('/');
    } else {
      setError(result.error ?? 'Login failed');
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-center">
          <NeonLogo className="w-64 h-auto" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm text-text-secondary">
              Username
            </label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm text-text-secondary">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-loss">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full bg-neon text-surface-base hover:bg-neon/90"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>

        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center rounded border border-loss/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-loss leading-tight transition-all duration-200 hover:bg-loss/10 hover:border-loss/70 hover:shadow-[0_0_8px_rgba(239,68,68,0.3)] cursor-default">
            S10
          </span>
          <span className="w-px h-3 bg-border-default" />
          <a
            href="https://github.com/sylvexn/cannoli"
            target="_blank"
            rel="noopener noreferrer"
            className="group/alpha inline-flex items-center rounded border border-pink/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-pink leading-tight transition-all duration-200 hover:bg-pink/10 hover:border-pink/70 hover:shadow-[0_0_8px_rgba(232,121,249,0.3)] cursor-pointer"
          >
            <span className="group-hover/alpha:hidden">alpha</span>
            <span className="hidden group-hover/alpha:inline">{__COMMIT_HASH__}</span>
          </a>
        </div>
      </div>
    </div>
  );
}
