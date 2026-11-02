import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatShortDate } from '../season/schedule-dates-step';
import { includedLeagues, leagueId, prevFor, summarySegments, teamComplete, type Draft } from './logic';
import { unresolvedCount } from './step-teams';
import type { ApiSeasonSetupDefaults } from '@/lib/api';

export function reviewWarnings(draft: Draft, status: Parameters<typeof unresolvedCount>[1]) {
  const noDates = Object.values(draft.weekDates).filter(Boolean).length === 0;
  return includedLeagues(draft).map(l => {
    const w: string[] = [];
    if (!l.draftDate) w.push('no draft date');
    const open = Math.max(0, l.expectedTeams - l.teams.filter(teamComplete).length);
    if (open) w.push(`${open} open slot${open > 1 ? 's' : ''}`);
    const un = unresolvedCount(l, status);
    if (un) w.push(`${un} unresolved account${un > 1 ? 's' : ''}`);
    if (noDates) w.push('no week dates');
    return { league: l, warnings: w };
  });
}

export function StepReview({ draft, defaults, status }: {
  draft: Draft;
  defaults: ApiSeasonSetupDefaults;
  status: Parameters<typeof unresolvedCount>[1];
}) {
  const rows = reviewWarnings(draft, status);
  const dates = Object.entries(draft.weekDates).filter(([, v]) => v).sort((a, b) => Number(a[0]) - Number(b[0]));
  const range = dates.length ? `${formatShortDate(dates[0][1])} - ${formatShortDate(dates[dates.length - 1][1])}` : '-';
  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] text-text-muted">
        {draft.totalWeeks} weeks · trade deadline W{Math.min(draft.tradeDeadlineWeek, draft.totalWeeks)} · {draft.playoffTeamCount} playoff teams · {draft.forfeitPolicy.replace('_', ' ')}
      </div>
      <div className="rounded-lg border border-border-subtle overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>League</TableHead><TableHead>ID</TableHead><TableHead>Rules</TableHead>
              <TableHead>Teams</TableHead><TableHead>Draft</TableHead><TableHead>Weeks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ league: l }) => (
              <TableRow key={l.key}>
                <TableCell className="whitespace-nowrap">
                  <span className="inline-block size-2.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: l.color }} />{l.name}
                </TableCell>
                <TableCell className="font-mono text-[11px]">{leagueId(draft.seasonNumber, l.slug)}</TableCell>
                <TableCell className="font-mono text-[11px] text-text-muted">
                  {summarySegments(l.rules, prevFor(l, defaults)).map((s, i) => (
                    <span key={i}>{i > 0 && ' · '}<span className={s.changed ? 'text-draw' : ''}>{s.text}</span></span>
                  ))}
                </TableCell>
                <TableCell className="font-mono text-xs">{l.teams.filter(teamComplete).length}/{l.expectedTeams}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{l.draftDate ? new Date(l.draftDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</TableCell>
                <TableCell className="text-xs whitespace-nowrap">{range}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-1.5">
        {rows.filter(r => r.warnings.length).map(({ league: l, warnings }) => (
          <div key={l.key} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-text-muted w-32 truncate min-w-0">{l.name}</span>
            {warnings.map(w => (
              <Badge key={w} variant="outline" className="gap-1 text-draw border-draw/40"><AlertTriangle size={10} />{w}</Badge>
            ))}
          </div>
        ))}
        {rows.every(r => !r.warnings.length) && <div className="text-xs text-win">No warnings.</div>}
        <p className="text-[11px] text-text-muted">Warnings do not block creation.</p>
      </div>
    </div>
  );
}
