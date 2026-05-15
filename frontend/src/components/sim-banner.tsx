/**
 * Site-wide simulator banner.
 *
 * Renders a slim, persistent strip at the very top of the app whenever the
 * backend reports `mode === 'mock'` (mock.cannoli.live is an interactive
 * season simulator, not a real deployment). Probes /api/health once on mount;
 * renders nothing on live or while the probe is in flight.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';

export function SimBanner() {
  const [mode, setMode] = useState<'live' | 'mock' | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getHealth()
      .then(h => { if (!cancelled) setMode(h.mode); })
      .catch(() => { if (!cancelled) setMode(null); });
    return () => { cancelled = true; };
  }, []);

  if (mode !== 'mock') return null;

  return (
    <div className="relative shrink-0 border-b border-draw/30 bg-gradient-to-r from-draw/[0.07] via-draw/[0.12] to-draw/[0.07]">
      <div className="flex items-center justify-center gap-3 px-4 py-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-mono font-bold uppercase tracking-[0.18em] text-draw">
          <FlaskConical size={12} className="shrink-0" />
          Simulator
        </span>
        <span className="hidden sm:inline h-3 w-px bg-draw/30" />
        <span className="hidden sm:inline text-text-secondary">
          Fictional data — drive the season from
        </span>
        <Link
          to="/admin/sim"
          className="group inline-flex items-center gap-1 rounded-full border border-draw/40 bg-draw/10 px-2 py-0.5 font-mono font-medium text-draw transition-colors hover:bg-draw/20 hover:border-draw/70"
        >
          Admin → Simulator
          <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
