/**
 * Arena tab — structured match lobby + battle HUD.
 * Phase 5c: skeleton layout. Phase 5d: full WS ready-up + scrim lobbies.
 */
import { useAuth } from '@/lib/auth-context';

export function ArenaTab() {
  const { user } = useAuth();

  return (
    <div className="h-full flex flex-col gap-4 overflow-y-auto">
      {/* Official match card */}
      <section className="rounded-lg border border-border-default bg-surface-raised p-5">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          This Week's Match
        </h2>
        {user ? (
          <div className="text-text-muted text-sm">
            No match scheduled this week.
          </div>
        ) : (
          <div className="text-text-muted text-sm">
            Log in to see your match.
          </div>
        )}
      </section>

      {/* Scrims section */}
      <section className="rounded-lg border border-border-default bg-surface-raised p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
            Scrims
          </h2>
          {user && (
            <button
              disabled
              className="px-3 py-1 text-xs rounded-md bg-surface-overlay text-text-muted cursor-not-allowed"
            >
              + Create Scrim
            </button>
          )}
        </div>
        <div className="text-text-muted text-sm">
          No active scrim lobbies.
        </div>
      </section>

      {/* Live matches */}
      <section className="rounded-lg border border-border-default bg-surface-raised p-5">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
          Live Now
        </h2>
        <div className="text-text-muted text-sm">
          No matches in progress.
        </div>
      </section>
    </div>
  );
}
