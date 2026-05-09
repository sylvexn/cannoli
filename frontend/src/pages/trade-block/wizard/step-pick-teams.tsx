import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TeamLogo } from '@/components/team-logo';
import { Users } from 'lucide-react';
import type { Player } from '@/lib/types';

interface PickTeamsStepProps {
  players: Player[];
  proposerTeamId: string | null;
  recipientId: string | null;
  setProposerTeamId: (id: string) => void;
  setRecipientId: (id: string) => void;
}

/**
 * Step 1 — pick the two teams. Proposer auto-selects the current user's owned
 * team upstream, but staff (admin/dev) can switch via the dropdown so the
 * wizard doubles as an admin-side trade builder.
 */
export function PickTeamsStep({
  players,
  proposerTeamId,
  recipientId,
  setProposerTeamId,
  setRecipientId,
}: PickTeamsStepProps) {
  const availableProposers = players.filter(p => p.id !== recipientId);
  const availableRecipients = players.filter(p => p.id !== proposerTeamId);

  const proposer = players.find(p => p.id === proposerTeamId) ?? null;
  const recipient = players.find(p => p.id === recipientId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Users size={12} />
        Pick the two teams involved in this trade.
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Your Team</label>
          <Select value={proposerTeamId ?? ''} onValueChange={setProposerTeamId}>
            <SelectTrigger className="h-9 text-xs bg-surface-overlay">
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {availableProposers.map(p => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                    {p.teamAbbrev} — {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-mono uppercase tracking-wider text-text-muted">Trade Partner</label>
          <Select value={recipientId ?? ''} onValueChange={setRecipientId}>
            <SelectTrigger className="h-9 text-xs bg-surface-overlay">
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {availableRecipients.map(p => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <TeamLogo abbrev={p.teamAbbrev} color={p.teamColor} size="sm" />
                    {p.teamAbbrev} — {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Confirmation strip — shows both team chips once chosen */}
      {(proposer || recipient) && (
        <div className="rounded-md border border-border-subtle bg-surface-overlay/30 p-3">
          <div className="grid grid-cols-2 gap-4 text-xs">
            <TeamSummary team={proposer} side="from" />
            <TeamSummary team={recipient} side="to" />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSummary({ team, side }: { team: Player | null; side: 'from' | 'to' }) {
  if (!team) {
    return (
      <div className="text-text-muted text-[11px]">
        {side === 'from' ? 'Your team will appear here.' : 'Pick a partner.'}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="md" />
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">{team.teamName}</div>
        <div className="text-[10px] text-text-muted font-mono uppercase tracking-wider">
          {team.roster.length} mons · {team.roster.reduce((s, m) => s + (m.tier || 0), 0)} pts
        </div>
      </div>
    </div>
  );
}
