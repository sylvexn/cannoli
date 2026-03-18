import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { formatShortDate } from './schedule-dates-step';
import type { LeagueTeamsState } from './provision-teams-step';

interface ConfirmStepProps {
  seasonNumber: number;
  copyPrevious: boolean;
  totalWeeks: number;
  pointCap: number;
  teraCaptainSlots: number;
  maxTeams: number;
  rosterSize: number;
  weekDates: Record<string, string>;
  teamsByLeague: LeagueTeamsState[];
  includedLeagues: { id: string; name: string; color: string; isNew: boolean }[];
}

export function ConfirmStep(props: ConfirmStepProps) {
  const {
    seasonNumber, copyPrevious, totalWeeks, pointCap, teraCaptainSlots, maxTeams,
    rosterSize, weekDates, teamsByLeague, includedLeagues,
  } = props;

  const totalTeams = teamsByLeague.reduce(
    (acc, l) => acc + l.rows.filter(r => r.teamName.trim() && r.teamAbbrev.trim()).length, 0,
  );
  const totalManagers = teamsByLeague.reduce(
    (acc, l) => acc + l.rows.filter(r => r.teamName.trim() && r.managerUsername.trim()).length, 0,
  );
  const filledDates = Object.entries(weekDates).filter(([, v]) => !!v);
  const sortedDates = filledDates.sort((a, b) => Number(a[0]) - Number(b[0]));

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">Review and confirm your new season setup.</p>
      <div className="bg-surface-overlay rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-text-muted">Season</span>
          <span className="text-text-primary font-mono">{seasonNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Source</span>
          <span className="text-text-primary">{copyPrevious ? 'Copied from S10' : 'Fresh setup'}</span>
        </div>
        <div className="flex justify-between items-start">
          <span className="text-text-muted">Leagues</span>
          <div className="flex gap-1 flex-wrap justify-end">
            {includedLeagues.map(l => (
              <Badge key={l.id} variant="outline" className="text-[10px]" style={{
                borderColor: `${l.color}40`, color: l.color, backgroundColor: `${l.color}10`,
              }}>
                {l.name.replace(' League', '')}{l.isNew && ' (new)'}
              </Badge>
            ))}
          </div>
        </div>
        <div className="border-t border-border-subtle pt-2 mt-2 space-y-1">
          <Row label="Weeks" value={totalWeeks} />
          <Row label="Point Cap" value={pointCap} />
          <Row label="Tera Captains" value={teraCaptainSlots} />
          <Row label="Max Teams" value={maxTeams} />
          <Row label="Roster Size" value={rosterSize} />
        </div>
        {totalTeams > 0 && (
          <div className="border-t border-border-subtle pt-2 mt-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-text-muted">Teams</span>
              <span className="font-mono">{totalTeams} across {teamsByLeague.length} league(s)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Managers assigned</span>
              <span className="font-mono">{totalManagers}/{totalTeams}</span>
            </div>
          </div>
        )}
        {sortedDates.length > 0 && (
          <div className="border-t border-border-subtle pt-2 mt-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Schedule</span>
              <span className="font-mono text-xs">
                W{sortedDates[0]![0]} {formatShortDate(sortedDates[0]![1])}
                {sortedDates.length > 1 ? ` – W${sortedDates[sortedDates.length - 1]![0]} ${formatShortDate(sortedDates[sortedDates.length - 1]![1])}` : ''}
                <span className="text-text-muted ml-1">({sortedDates.length}/{totalWeeks})</span>
              </span>
            </div>
          </div>
        )}
      </div>
      {filledDates.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-draw/30 bg-draw/5 p-3 text-xs text-text-secondary">
          <AlertTriangle size={14} className="text-draw shrink-0 mt-0.5" />
          <span>
            No schedule dates set. Auto-forfeit and auto-week-advance jobs won't fire until you set
            weekly dates in league settings later.
          </span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
