/**
 * Sticky match banner — fixed bottom-right notification when the player
 * has an unplayed match in the current week. Points to Arena.
 *
 * Does not render on /showdown/* pages (you're already there),
 * during draft/offseason phases, or for admins without teams.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { Swords, X } from 'lucide-react';

interface BannerMatch {
  matchId: string;
  week: number;
  status: string;
  readyHome: boolean;
  readyAway: boolean;
  homeTeam: { name: string } | null;
  awayTeam: { name: string } | null;
  isHome: boolean;
}

export function MatchBanner() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<BannerMatch | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Fetch match state periodically
  useEffect(() => {
    if (!user) return;

    const fetchMatch = () => {
      fetch('/api/arena/state', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
          if (data.myMatch && data.myMatch.status !== 'completed') {
            setMatch(data.myMatch);
          } else {
            setMatch(null);
          }
        })
        .catch(() => {});
    };

    fetchMatch();
    const interval = setInterval(fetchMatch, 30_000); // Poll every 30s
    return () => clearInterval(interval);
  }, [user]);

  // Don't render on showdown pages, when dismissed, or when no match
  if (!match || dismissed) return null;
  if (pathname.startsWith('/showdown')) return null;

  const opponentReady = match.isHome ? match.readyAway : match.readyHome;
  const opponentTeam = match.isHome ? match.awayTeam : match.homeTeam;

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 duration-300">
      <div className="bg-surface-raised border border-border-default rounded-lg shadow-lg p-3 pr-8 max-w-xs">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 text-text-muted hover:text-text-primary"
        >
          <X size={12} />
        </button>

        <div className="flex items-start gap-2">
          <Swords size={16} className="text-orange-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              Week {match.week} — vs. {opponentTeam?.name ?? 'TBD'}
            </div>

            {match.status === 'in_progress' ? (
              <div className="text-xs text-green-400 font-medium mt-1">
                Match live!
              </div>
            ) : opponentReady ? (
              <div className="text-xs text-green-400 font-medium mt-1 animate-pulse">
                Opponent is waiting!
              </div>
            ) : null}

            <button
              onClick={() => navigate('/showdown?tab=arena')}
              className="mt-2 px-3 py-1 text-xs rounded-md bg-orange-400/15 text-orange-400 hover:bg-orange-400/25 transition-colors font-medium"
            >
              {match.status === 'in_progress' ? 'Return to Arena →' : 'Go to Arena →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
