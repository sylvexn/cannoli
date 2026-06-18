/**
 * Admin → League → Membership.
 *
 * A single surface for sorting coaches into the season's leagues *before the
 * draft starts*: add a late signup, drop a coach, or move a coach from one
 * league to another. Leagues render side by side so the whole season's lineup
 * is visible at once.
 *
 * Membership edits are gated server-side (`isMembershipEditable`) to the
 * predraft / draft-not-started window; once a league is past that, its column
 * shows a lock and all controls disable. A coach's career record (W/L, K/D,
 * championships) is tied to their user account, so moving leagues never loses
 * stats — see the note in the header.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { TeamLogo } from '@/components/team-logo';
import { api } from '@/lib/api';
import type { ApiMembership, ApiMembershipLeague, ApiMembershipCoach, ApiAuthUser } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import {
  Plus, Trash2, Lock, Trophy, UserCog, ArrowRightLeft, Info,
} from 'lucide-react';

const QUICK_COLORS = [
  '#ee8130', '#6390f0', '#7ac74c', '#a33ea1',
  '#e2bf65', '#96d9d6', '#c22e28', '#a98ff3',
  '#f95587', '#b6a136', '#735797', '#b7b7ce',
];

interface AddFormState {
  userId: number | null;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  coachName: string;
}

function emptyAddForm(): AddFormState {
  return { userId: null, teamName: '', teamAbbrev: '', teamColor: QUICK_COLORS[0], coachName: '' };
}

export function AdminMembership() {
  const [data, setData] = useState<ApiMembership | null>(null);
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Add dialog
  const [addLeague, setAddLeague] = useState<ApiMembershipLeague | null>(null);
  const [addForm, setAddForm] = useState<AddFormState>(emptyAddForm);

  // Remove dialog
  const [removing, setRemoving] = useState<{ coach: ApiMembershipCoach; leagueName: string } | null>(null);

  // Replace-coach dialog (deliberate override of the membership lock — keeps the
  // team and all its data, only swaps the linked user account).
  const [replacing, setReplacing] = useState<{ coach: ApiMembershipCoach; league: ApiMembershipLeague } | null>(null);
  const [replaceUserId, setReplaceUserId] = useState<number | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.getMembership(), api.getUsers()])
      .then(([m, u]) => { setData(m); setUsers(u); })
      .catch(err => toast.error(getErrorMessage(err, 'Failed to load membership')))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function openAdd(league: ApiMembershipLeague) {
    setAddForm(emptyAddForm());
    setAddLeague(league);
  }

  async function submitAdd() {
    if (!addLeague) return;
    const { userId, teamName, teamAbbrev, teamColor, coachName } = addForm;
    if (userId == null || !teamName.trim() || !teamAbbrev.trim()) {
      toast.error('Pick a user and enter a team name + abbreviation');
      return;
    }
    setBusy(true);
    try {
      await api.addCoach({
        leagueId: addLeague.id,
        userId,
        teamName: teamName.trim(),
        teamAbbrev: teamAbbrev.trim().toUpperCase(),
        teamColor,
        coachName: coachName.trim() || undefined,
      });
      toast.success(`Added ${teamName.trim()} to ${addLeague.name}`);
      setAddLeague(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Add failed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(coach: ApiMembershipCoach, toLeagueId: string) {
    const dest = data?.leagues.find(l => l.id === toLeagueId);
    setBusy(true);
    try {
      await api.moveCoach(coach.id, toLeagueId);
      toast.success(`Moved ${coach.teamName} to ${dest?.name ?? toLeagueId}`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Move failed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.removeCoachTeam(removing.coach.id);
      toast.success(`Removed ${removing.coach.teamName} from ${removing.leagueName}`);
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Remove failed'));
    } finally {
      setBusy(false);
    }
  }

  function openReplace(coach: ApiMembershipCoach, league: ApiMembershipLeague) {
    setReplaceUserId(null);
    setReplacing({ coach, league });
  }

  async function handleReplace() {
    if (!replacing || replaceUserId == null) return;
    setBusy(true);
    try {
      await api.replaceCoach(replacing.coach.id, { newUserId: replaceUserId });
      toast.success(`Replaced coach of ${replacing.coach.teamName}`);
      setReplacing(null);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Replace failed'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-text-muted text-sm">Loading membership…</div>;
  if (!data || data.leagues.length === 0) {
    return <div className="text-text-muted text-sm">No leagues in the current season yet.</div>;
  }

  const totalCoaches = data.leagues.reduce((n, l) => n + l.teams.length, 0);

  return (
    <div className="space-y-4">
      {/* Header note — stats are coach-tied */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-text-muted">Season:</span>
        <span className="font-mono font-medium text-text-primary">S{data.seasonNumber}</span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">Coaches:</span>
        <span className="font-mono font-medium text-text-primary">{totalCoaches}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted">
          <Info size={12} className="text-neon" />
          Career stats (W/L, K/D) follow the coach across leagues automatically.
        </span>
      </div>

      {/* Side-by-side league columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {data.leagues.map(league => (
          <LeagueColumn
            key={league.id}
            league={league}
            allLeagues={data.leagues}
            busy={busy}
            onAdd={() => openAdd(league)}
            onMove={handleMove}
            onRemove={(coach) => setRemoving({ coach, leagueName: league.name })}
            onReplace={(coach) => openReplace(coach, league)}
          />
        ))}
      </div>

      {/* Add coach dialog */}
      <Dialog open={!!addLeague} onOpenChange={v => { if (!v) setAddLeague(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add coach to {addLeague?.name}</DialogTitle>
            <DialogDescription>
              Bind an existing user account to a new team. Their career record
              carries over automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="User Account" icon={<UserCog size={11} />}>
              <Select
                value={addForm.userId == null ? '' : String(addForm.userId)}
                onValueChange={(v) => setAddForm(f => ({ ...f, userId: v ? parseInt(v) : null }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter(u => u.active)
                    .sort((a, b) => a.username.localeCompare(b.username))
                    .map(u => {
                      const taken = addLeague?.teams.some(t => String(t.userId) === String(u.id));
                      return (
                        <SelectItem key={u.id} value={String(u.id)} disabled={taken}>
                          {u.username} <span className="text-text-muted">({u.role}{taken ? ' · in league' : ''})</span>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Team Name">
                <Input
                  value={addForm.teamName}
                  onChange={e => setAddForm(f => ({ ...f, teamName: e.target.value }))}
                  placeholder="Sapphire Sentinels"
                />
              </Field>
              <Field label="Abbreviation">
                <Input
                  value={addForm.teamAbbrev}
                  onChange={e => setAddForm(f => ({ ...f, teamAbbrev: e.target.value.toUpperCase() }))}
                  placeholder="SAS"
                  maxLength={5}
                />
              </Field>
            </div>

            <Field label="Coach Name (optional — defaults to username)">
              <Input
                value={addForm.coachName}
                onChange={e => setAddForm(f => ({ ...f, coachName: e.target.value }))}
                placeholder="Sylvex"
              />
            </Field>

            <Field label="Team Color">
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAddForm(f => ({ ...f, teamColor: c }))}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${addForm.teamColor === c ? 'border-text-primary scale-110' : 'border-transparent hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Input
                  value={addForm.teamColor}
                  onChange={e => setAddForm(f => ({ ...f, teamColor: e.target.value }))}
                  className="w-24 h-8 text-[11px] font-mono"
                  maxLength={7}
                />
              </div>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLeague(null)} disabled={busy}>Cancel</Button>
            <Button onClick={submitAdd} disabled={busy} className="bg-neon text-surface-base hover:bg-neon/90">
              {busy ? 'Adding…' : 'Add coach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm dialog */}
      <Dialog open={!!removing} onOpenChange={v => { if (!v) setRemoving(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.coach.teamName}?</DialogTitle>
            <DialogDescription>
              Removes this team from {removing?.leagueName}. The user account and
              their past-season career record are untouched — only this league
              participation goes away.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button onClick={handleRemove} disabled={busy} className="bg-loss text-surface-base hover:bg-loss/90">
              <Trash2 size={14} />
              {busy ? 'Removing…' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace coach dialog — deliberate lock override; keeps the team intact. */}
      <Dialog open={!!replacing} onOpenChange={v => { if (!v) setReplacing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace coach of {replacing?.coach.teamName}?</DialogTitle>
            <DialogDescription>
              The team, its roster, draft picks, and all completed results stay
              intact. This season's win/loss and K/D for matches already played
              will be credited to the new coach. The departing coach loses access
              to this team immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="New Coach" icon={<UserCog size={11} />}>
              <Select
                value={replaceUserId == null ? '' : String(replaceUserId)}
                onValueChange={(v) => setReplaceUserId(v ? parseInt(v) : null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a user…" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter(u => u.active)
                    .sort((a, b) => a.username.localeCompare(b.username))
                    .map(u => {
                      const taken = replacing?.league.teams.some(
                        t => t.id !== replacing.coach.id && String(t.userId) === String(u.id),
                      );
                      const current = String(replacing?.coach.userId) === String(u.id);
                      return (
                        <SelectItem key={u.id} value={String(u.id)} disabled={taken || current}>
                          {u.username} <span className="text-text-muted">({u.role}{current ? ' · current' : taken ? ' · in league' : ''})</span>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(null)} disabled={busy}>Cancel</Button>
            <Button
              onClick={handleReplace}
              disabled={busy || replaceUserId == null}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              <UserCog size={14} />
              {busy ? 'Replacing…' : 'Replace coach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeagueColumn({ league, allLeagues, busy, onAdd, onMove, onRemove, onReplace }: {
  league: ApiMembershipLeague;
  allLeagues: ApiMembershipLeague[];
  busy: boolean;
  onAdd: () => void;
  onMove: (coach: ApiMembershipCoach, toLeagueId: string) => void;
  onRemove: (coach: ApiMembershipCoach) => void;
  onReplace: (coach: ApiMembershipCoach) => void;
}) {
  const otherLeagues = allLeagues.filter(l => l.id !== league.id);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base min-w-0">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: league.color }} />
            <span className="truncate">{league.name}</span>
            <Badge variant="outline" className="text-[10px] shrink-0">{league.teams.length}</Badge>
            {!league.editable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-[10px] text-draw">
                    <Lock size={11} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{league.lockReason}</TooltipContent>
              </Tooltip>
            )}
          </CardTitle>
          <Button
            size="sm"
            onClick={onAdd}
            disabled={!league.editable || busy}
            className="bg-neon text-surface-base hover:bg-neon/90 shrink-0"
          >
            <Plus size={14} />
            Add
          </Button>
        </div>
        {!league.editable && (
          <p className="text-[10px] text-draw/80 mt-1">{league.lockReason}</p>
        )}
      </CardHeader>
      <CardContent>
        {league.teams.length === 0 ? (
          <div className="text-center py-6 text-sm text-text-muted">No coaches yet.</div>
        ) : (
          <div className="space-y-2">
            {league.teams.map(coach => (
              <CoachRow
                key={coach.id}
                coach={coach}
                editable={league.editable}
                busy={busy}
                otherLeagues={otherLeagues}
                onMove={onMove}
                onRemove={onRemove}
                onReplace={onReplace}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoachRow({ coach, editable, busy, otherLeagues, onMove, onRemove, onReplace }: {
  coach: ApiMembershipCoach;
  editable: boolean;
  busy: boolean;
  otherLeagues: ApiMembershipLeague[];
  onMove: (coach: ApiMembershipCoach, toLeagueId: string) => void;
  onRemove: (coach: ApiMembershipCoach) => void;
  onReplace: (coach: ApiMembershipCoach) => void;
}) {
  const career = coach.career;
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border-subtle hover:border-border-default transition-colors">
      <TeamLogo abbrev={coach.teamAbbrev} color={coach.teamColor} size="md" logoPath={coach.logoPath} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-text-primary truncate">{coach.teamName}</span>
          <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{coach.teamAbbrev}</Badge>
        </div>
        <div className="text-[10px] text-text-muted flex items-center gap-2 mt-0.5">
          {coach.manager ? (
            <Link
              to={`/coach/${coach.manager.username}`}
              className="flex items-center gap-1 text-text-secondary hover:text-neon transition-colors"
            >
              <UserCog size={9} />
              {coach.manager.username}
            </Link>
          ) : (
            <span className="flex items-center gap-1 text-loss/70">
              <UserCog size={9} />
              No account
            </span>
          )}
          {career && career.seasonsPlayed > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 font-mono tabular-nums cursor-default">
                  {career.wins}-{career.losses}
                  {career.championships > 0 && (
                    <span className="flex items-center gap-0.5 text-amber-400">
                      <Trophy size={9} />{career.championships}
                    </span>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Career across {career.seasonsPlayed} season{career.seasonsPlayed === 1 ? '' : 's'}:
                {' '}{career.wins}-{career.losses} record, {career.kills} K / {career.deaths} D
                {career.championships > 0 ? `, ${career.championships}× champion` : ''}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Move-to dropdown (action menu; value never sticks) */}
      {otherLeagues.length > 0 && (
        <Select
          value=""
          disabled={!editable || busy}
          onValueChange={(v) => v && onMove(coach, v)}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger
                className="w-9 h-8 px-0 justify-center shrink-0 [&>svg:last-child]:hidden"
                aria-label="Move to league"
              >
                <ArrowRightLeft size={13} />
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent>Move to another league</TooltipContent>
          </Tooltip>
          <SelectContent>
            {otherLeagues.map(l => (
              <SelectItem key={l.id} value={l.id} disabled={!l.editable}>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
                  {l.name}{!l.editable ? ' (locked)' : ''}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Replace coach — deliberate override; stays enabled even when the
          league is locked (it keeps the same team, so no data is stranded). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onReplace(coach)}
            disabled={busy}
            className="shrink-0"
            aria-label="Replace coach"
          >
            <UserCog size={11} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Replace coach (keeps the team)</TooltipContent>
      </Tooltip>

      <Button
        size="xs"
        variant="outline"
        onClick={() => onRemove(coach)}
        disabled={!editable || busy}
        className="shrink-0 text-loss border-loss/30 hover:bg-loss/10"
        aria-label="Remove coach"
      >
        <Trash2 size={11} />
      </Button>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-text-muted flex items-center gap-1">
        {icon}
        {label}
      </label>
      {children}
    </div>
  );
}
