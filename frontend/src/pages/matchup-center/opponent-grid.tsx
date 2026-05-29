import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { ApiTeam } from '@/lib/api';
import type { League } from '@/lib/types';

interface OpponentGridProps {
  league: League;
  teams: ApiTeam[];
  /** Team to exclude (your own team — no point picking yourself). */
  excludeTeamId?: string;
  onSelect: (team: ApiTeam) => void;
}

/**
 * Tap-to-pick grid of teams in the same league as the user's pre-populated
 * "your team". Replaces the empty "Select an opponent above" card on first
 * load so the page is useful immediately — one tap loads the matchup view.
 */
export function OpponentGrid({ league, teams, excludeTeamId, onSelect }: OpponentGridProps) {
  const opponents = teams.filter(t => t.id !== excludeTeamId);

  if (opponents.length === 0) {
    return (
      <div className="flex-1 rounded-lg border border-dashed border-[#ef4444]/20 bg-[#ef4444]/5 p-4 flex items-center justify-center">
        <span className="text-sm text-text-muted">No other teams in this league.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/5 p-2">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-xs font-medium text-[#ef4444]">Pick an opponent</span>
        <span className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
          {league.name.replace(' League', '')}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {opponents.map(team => (
          <button
            key={team.id}
            onClick={() => onSelect(team)}
            className={cn(
              'card-interactive group flex items-center gap-2 rounded-md border border-border-subtle/60',
              'bg-surface-overlay/30 px-2 py-1.5 text-left min-w-0',
            )}
            title={`${team.teamName} (${team.record.wins}-${team.record.losses})`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-inset ring-black/20"
              style={{ backgroundColor: team.teamColor }}
            />
            <span
              className="text-[11px] font-mono font-bold shrink-0"
              style={{ color: team.teamColor }}
            >
              {team.teamAbbrev}
            </span>
            <span className="text-[11px] text-text-secondary truncate group-hover:text-text-primary transition-colors">
              {team.teamName}
            </span>
          </button>
        ))}
      </div>
      {/* Footer link to the league hub for browsing further. */}
      <div className="mt-1.5 px-1">
        <Link
          to={`/league/${league.id}`}
          className="text-[10px] text-text-muted hover:text-neon transition-colors"
        >
          Or browse {league.name.replace(' League', '')} {'->'}
        </Link>
      </div>
    </div>
  );
}
