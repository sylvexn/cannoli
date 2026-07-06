import { Suspense, useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { NeonLogo } from '@/components/neon-logo';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api, type ApiLeague } from '@/lib/api';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FlaskConical, ChevronRight } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { leagueGem } from '@/lib/constants';
import { BRAND_PALETTE, buildGradientCss } from '@/lib/shader-gradient';
import { ShaderField } from '@/components/shader-field-lazy';

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
  const { login, isAuthenticated, user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [leagues, setLeagues] = useState<ApiLeague[] | null>(null);
  const [isMockMode, setIsMockMode] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState('');

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

  // Probe /api/health to determine if this is the mock (demo) deployment.
  // Used to conditionally show the "Enter demo as admin" card.
  useEffect(() => {
    api.getHealth()
      .then(h => setIsMockMode(h.mode === 'mock'))
      .catch(() => setIsMockMode(false));
  }, []);

  async function handleDemoLogin() {
    setDemoLoading(true);
    setDemoError('');
    try {
      await api.demoLogin();
      await refreshUser();
      navigate('/');
    } catch (err: unknown) {
      setDemoError(getErrorMessage(err, 'Demo login failed'));
      setDemoLoading(false);
    }
  }

  // __COMMIT_HASH__ is injected by vite.config.ts (git rev-parse --short HEAD,
  // 'unknown' fallback). Map 'unknown' to 'dev' for the user-facing chip.
  const buildHash = __COMMIT_HASH__ === 'unknown' ? 'dev' : __COMMIT_HASH__;

  // Current season number, derived from the active leagues (highest wins) so the
  // chip tracks the live season instead of a hardcoded label.
  const currentSeason = leagues && leagues.length > 0
    ? leagues.reduce((m, l) => Math.max(m, l.season?.seasonNumber ?? 0), 0) || null
    : null;

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
    <div className="min-h-dvh bg-surface flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated shader backdrop (GPU-gated; static gradient fallback otherwise) */}
      <Suspense fallback={<div className="absolute inset-0 z-0" style={{ background: buildGradientCss(BRAND_PALETTE) }} />}>
        <ShaderField colors={BRAND_PALETTE} speed={0.55} distortion={1.0} className="absolute inset-0 z-0" />
      </Suspense>
      {/* Dark scrim keeps the centered card crisp over the motion */}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 58% 50% at 50% 45%, rgba(8,8,13,0.55) 0%, rgba(8,8,13,0.86) 100%)' }}
      />
      {/* Dot-grid texture, dialed back, layered above the shader */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-60" style={DOT_GRID_STYLE} />

      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="flex flex-col items-center gap-2">
          <NeonLogo className="w-64 h-auto" />
          <p className="text-[11px] font-mono uppercase tracking-[0.25em] text-text-muted/70">
            Pokémon Draft League
          </p>
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
            className="btn-gradient w-full text-surface-base font-semibold border-0 disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>

          {/* First-time orientation on the live deployment (the mock build shows
              the demo card below instead, which already explains itself). */}
          {!isMockMode && (
            <p className="text-center text-xs text-text-muted leading-relaxed">
              Sign in with the username and password from your league admin.
            </p>
          )}
        </form>

        {/* Demo access card — only rendered on mock.cannoli.live (CANNOLI_MODE=mock).
            Probed via /api/health; never shown on the live deployment. */}
        {isMockMode && (
          <div className="rounded-lg border border-neon/25 bg-neon/5 px-4 py-3.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-3.5 h-3.5 text-neon shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-widest text-neon">
                Season simulator demo
              </span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              This is a public preview running simulated season data. Sign in below with your own credentials, or jump straight into an admin-capable demo session.
            </p>
            {demoError && (
              <p className="text-xs text-loss">{demoError}</p>
            )}
            <Button
              type="button"
              onClick={handleDemoLogin}
              disabled={demoLoading}
              className="w-full flex items-center justify-center gap-1.5 bg-neon/10 border border-neon/40 text-neon hover:bg-neon/20 hover:border-neon/70 hover:shadow-[0_0_12px_rgba(var(--color-neon-rgb,74,222,128),0.25)] transition-all duration-200 text-sm font-medium"
            >
              {demoLoading ? (
                'Entering demo...'
              ) : (
                <>
                  Enter demo as admin
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          <span className="inline-flex items-center rounded border border-loss/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-loss leading-tight transition-all duration-200 hover:bg-loss/10 hover:border-loss/70 hover:shadow-[0_0_8px_rgba(239,68,68,0.3)] cursor-default">
            {currentSeason ? `S${currentSeason}` : 'Cannoli'}
          </span>
          <span className="w-px h-3 bg-border-default" />
          <Tooltip>
            <TooltipTrigger
              render={(props) => (
                <a
                  {...props}
                  href="https://github.com/sylvexn/cannoli"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded border border-pink/40 bg-surface-base px-2 py-0.5 text-[10px] font-mono text-pink leading-tight transition-all duration-200 hover:bg-pink/10 hover:border-pink/70 hover:shadow-[0_0_8px_rgba(232,121,249,0.3)] cursor-pointer"
                >
                  alpha
                </a>
              )}
            />
            <TooltipContent>
              <span className="font-mono text-[10px]">{__COMMIT_HASH__}</span>
            </TooltipContent>
          </Tooltip>
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
                    <div className={`league-banner league-banner-${leagueGem(league.id)} flex-1 min-w-0`}>
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
