import { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { NeonLogo } from '@/components/neon-logo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, type ApiLeague } from '@/lib/api';

// Compact phase labels for the public active-leagues strip. We deliberately
// use lowercase here — pre-auth ornament, reads like a status line, not a UI
// label.
const PHASE_LABEL: Record<string, string> = {
  predraft: 'pre-draft',
  draft: 'drafting',
  regular: 'regular season',
  playoffs: 'playoffs',
  offseason: 'offseason',
};

// Faint dot-grid texture layered above the body::before radial wash. ~3.5%
// opacity dots on a 24px grid — quiet enough to not compete with the neon
// logo, present enough that the page reads "intentional" rather than "down."
const DOT_GRID_STYLE: React.CSSProperties = {
  backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [leagues, setLeagues] = useState<ApiLeague[] | null>(null);

  // Fetch public league list for the ambient strip below the form. /api/leagues
  // is unauthenticated (GETs bypass the auth guard), so this works pre-login.
  // Failure is silent — the strip just doesn't render.
  useEffect(() => {
    let cancelled = false;
    api.getLeagues()
      .then(data => { if (!cancelled) setLeagues(data); })
      .catch(() => { if (!cancelled) setLeagues([]); });
    return () => { cancelled = true; };
  }, []);

  // __COMMIT_HASH__ is injected by vite.config.ts (git rev-parse --short HEAD,
  // 'unknown' fallback). Map 'unknown' to 'dev' for the user-facing chip.
  const buildHash = __COMMIT_HASH__ === 'unknown' ? 'dev' : __COMMIT_HASH__;

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
    <div
      className="min-h-screen bg-surface flex items-center justify-center p-4 relative"
      style={DOT_GRID_STYLE}
    >
      <div className="w-full max-w-sm space-y-8 relative">
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
          <span className="w-px h-3 bg-border-default" />
          <span
            title="Build"
            className="inline-flex items-center rounded border border-border-default/60 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-text-muted leading-tight cursor-default"
          >
            build {buildHash}
          </span>
        </div>

        {/* Active leagues mini-strip — pre-auth ornament. Reads from the public
            /api/leagues endpoint; falls silent on fetch failure. Banners are
            visual only (no anchors) to avoid pre-auth routing complexity. */}
        {leagues && leagues.length > 0 && (
          <div className="pt-2 border-t border-border-default/30">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted/70 mb-2 text-center">
              Active leagues
            </div>
            <div className="flex flex-col gap-1.5">
              {leagues.map(league => {
                const phase = league.season?.phase;
                const phaseLabel = phase ? PHASE_LABEL[phase] ?? phase : 'inactive';
                return (
                  <div key={league.id} className="flex items-center gap-2">
                    <div className={`league-banner league-banner-${league.id} flex-1 min-w-0`}>
                      <span className="league-banner-text text-white truncate">
                        {league.name.replace(' League', '')}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-text-muted/80 shrink-0 w-24 text-right">
                      {phaseLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
