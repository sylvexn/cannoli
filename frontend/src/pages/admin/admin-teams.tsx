import { useEffect, useRef, useState } from 'react';
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
import { useAppData } from '@/lib/app-data-context';
import { api } from '@/lib/api';
import type { ApiTeam, ApiAuthUser } from '@/lib/api';
import { TeamLogo } from '@/components/team-logo';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import {
  Upload, ImageIcon, Plus, Pencil, Trash2,
  UserCog, Palette, X,
} from 'lucide-react';

const QUICK_COLORS = [
  '#ee8130', '#6390f0', '#7ac74c', '#a33ea1',
  '#e2bf65', '#96d9d6', '#c22e28', '#a98ff3',
  '#f95587', '#b6a136', '#735797', '#b7b7ce',
];

interface TeamFormState {
  coachName: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  userId: number | null;
  logoPath: string | null;
}

function emptyForm(): TeamFormState {
  return {
    coachName: '',
    teamName: '',
    teamAbbrev: '',
    teamColor: QUICK_COLORS[0],
    userId: null,
    logoPath: null,
  };
}

export function AdminTeams() {
  const { leagues } = useAppData();
  const [teamsPerLeague, setTeamsPerLeague] = useState<Record<string, ApiTeam[]>>({});
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formLeagueId, setFormLeagueId] = useState<string>('');
  const [formTeamId, setFormTeamId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  // Delete dialog
  const [deletingTeam, setDeletingTeam] = useState<ApiTeam | null>(null);
  const [deleteForce, setDeleteForce] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function loadTeams() {
    if (leagues.length === 0) return;
    setLoading(true);
    Promise.all(
      leagues.map(l => api.getTeams(l.id).then(teams => [l.id, teams] as const))
    ).then(results => {
      setTeamsPerLeague(Object.fromEntries(results));
      setLoading(false);
    });
  }

  useEffect(loadTeams, [leagues]);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => {});
  }, []);

  function openCreate(leagueId: string) {
    setFormMode('create');
    setFormLeagueId(leagueId);
    setFormTeamId(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(team: ApiTeam, leagueId: string) {
    setFormMode('edit');
    setFormLeagueId(leagueId);
    setFormTeamId(team.id);
    setForm({
      coachName: team.name || '',
      teamName: team.teamName,
      teamAbbrev: team.teamAbbrev,
      teamColor: team.teamColor,
      userId: team.userId ?? null,
      logoPath: team.logoPath ?? null,
    });
    setFormOpen(true);
  }

  async function submitForm() {
    const { coachName, teamName, teamAbbrev, teamColor, userId } = form;
    if (!coachName.trim() || !teamName.trim() || !teamAbbrev.trim()) {
      toast.error('Coach, team name, and abbreviation are required');
      return;
    }
    setSubmitting(true);
    try {
      if (formMode === 'create') {
        await api.createTeam(formLeagueId, {
          coachName: coachName.trim(),
          teamName: teamName.trim(),
          teamAbbrev: teamAbbrev.trim().toUpperCase(),
          teamColor,
          userId: userId ?? null,
        });
        toast.success(`Created ${teamName}`);
      } else if (formTeamId) {
        await api.updateTeam(formTeamId, {
          coachName: coachName.trim(),
          teamName: teamName.trim(),
          teamAbbrev: teamAbbrev.trim().toUpperCase(),
          teamColor,
          userId: userId ?? null,
        });
        toast.success(`Updated ${teamName}`);
      }
      setFormOpen(false);
      loadTeams();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Save failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingTeam) return;
    setDeleting(true);
    try {
      await api.deleteTeam(deletingTeam.id, { force: deleteForce });
      toast.success(`Deleted ${deletingTeam.teamName}`);
      setDeletingTeam(null);
      setDeleteForce(false);
      loadTeams();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Delete failed'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleLogoUpload(teamId: string, file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2MB');
      return;
    }
    try {
      const result = await api.uploadTeamLogo(teamId, file);
      const newPath = result.path.replace(/^\/uploads\//, '') + `?v=${Date.now()}`;
      setTeamsPerLeague(prev => {
        const next: Record<string, ApiTeam[]> = {};
        for (const [lid, teams] of Object.entries(prev)) {
          next[lid] = teams.map(t =>
            t.id === teamId ? { ...t, logoPath: newPath } : t
          );
        }
        return next;
      });
      // Sync the in-flight form preview when the upload happened from the
      // dialog field (edit mode for the team currently in the form).
      if (formTeamId === teamId) {
        setForm(f => ({ ...f, logoPath: newPath }));
      }
      toast.success(`Logo uploaded for ${teamId.split('-').pop()?.toUpperCase()}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    }
  }

  async function handleLogoRemove(teamId: string) {
    try {
      await api.removeTeamLogo(teamId);
      setTeamsPerLeague(prev => {
        const next: Record<string, ApiTeam[]> = {};
        for (const [lid, teams] of Object.entries(prev)) {
          next[lid] = teams.map(t =>
            t.id === teamId ? { ...t, logoPath: null } : t
          );
        }
        return next;
      });
      if (formTeamId === teamId) {
        setForm(f => ({ ...f, logoPath: null }));
      }
      toast.success('Logo removed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Remove failed'));
    }
  }

  if (loading) return <div className="text-text-muted text-sm">Loading teams...</div>;

  const allTeams = Object.values(teamsPerLeague).flat();
  const logoCount = allTeams.filter(t => !!t.logoPath).length;
  const managedCount = allTeams.filter(t => t.userId != null).length;

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Total Teams" value={allTeams.length} />
        <Stat label="Managers Assigned" value={`${managedCount}/${allTeams.length}`} accent={managedCount === allTeams.length ? 'win' : 'draw'} />
        <Stat label="Logos Set" value={`${logoCount}/${allTeams.length}`} accent={logoCount === allTeams.length ? 'win' : 'draw'} />
      </div>

      {/* Per-league sections */}
      {leagues.map(league => {
        const teams = teamsPerLeague[league.id] || [];
        return (
          <Card key={league.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: league.color }} />
                  {league.name}
                  <Badge variant="outline" className="text-[10px]">{teams.length} teams</Badge>
                </CardTitle>
                <Button
                  size="sm"
                  onClick={() => openCreate(league.id)}
                  className="bg-neon text-surface-base hover:bg-neon/90"
                >
                  <Plus size={14} />
                  Add Team
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {teams.length === 0 ? (
                <div className="text-center py-6 text-sm text-text-muted">
                  No teams yet. Click "Add Team" to create one.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                  {teams.map(team => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      manager={users.find(u => String(u.id) === String(team.userId))}
                      onUpload={(file) => handleLogoUpload(team.id, file)}
                      onEdit={() => openEdit(team, league.id)}
                      onDelete={() => { setDeletingTeam(team); setDeleteForce(false); }}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Create/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={v => { if (!v) setFormOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{formMode === 'create' ? 'New Team' : `Edit ${form.teamAbbrev}`}</DialogTitle>
            <DialogDescription>
              {formMode === 'create'
                ? `Add a team to ${leagues.find(l => l.id === formLeagueId)?.name ?? 'this league'}.`
                : 'Update team metadata. The team ID stays fixed.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Coach Name">
                <Input
                  value={form.coachName}
                  onChange={e => setForm(f => ({ ...f, coachName: e.target.value }))}
                  placeholder="e.g. Sylvex"
                />
              </FormField>
              <FormField label="Abbreviation">
                <Input
                  value={form.teamAbbrev}
                  onChange={e => setForm(f => ({ ...f, teamAbbrev: e.target.value.toUpperCase() }))}
                  placeholder="SAS"
                  maxLength={5}
                  disabled={formMode === 'edit'}
                />
              </FormField>
            </div>
            <FormField label="Team Name">
              <Input
                value={form.teamName}
                onChange={e => setForm(f => ({ ...f, teamName: e.target.value }))}
                placeholder="e.g. Sapphire Sentinels"
              />
            </FormField>

            <FormField label="Team Logo" icon={<ImageIcon size={11} />}>
              <LogoFormRow
                logoPath={form.logoPath}
                teamColor={form.teamColor}
                teamAbbrev={form.teamAbbrev}
                disabled={formMode === 'create'}
                onUpload={file => formTeamId && handleLogoUpload(formTeamId, file)}
                onRemove={() => formTeamId && handleLogoRemove(formTeamId)}
              />
            </FormField>

            <FormField label="Team Color" icon={<Palette size={11} />}>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, teamColor: c }))}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${form.teamColor === c ? 'border-text-primary scale-110' : 'border-transparent hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <Input
                  value={form.teamColor}
                  onChange={e => setForm(f => ({ ...f, teamColor: e.target.value }))}
                  className="w-24 h-8 text-[11px] font-mono"
                  maxLength={7}
                />
              </div>
            </FormField>

            <FormField label="Manager (User Account)" icon={<UserCog size={11} />}>
              <Select
                value={form.userId == null ? 'none' : String(form.userId)}
                onValueChange={(v: string | null) => setForm(f => ({ ...f, userId: !v || v === 'none' ? null : parseInt(v) }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {users
                    .filter(u => u.active)
                    .sort((a, b) => a.username.localeCompare(b.username))
                    .map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.username} <span className="text-text-muted">({u.role})</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={submitForm}
              disabled={submitting}
              className="bg-neon text-surface-base hover:bg-neon/90"
            >
              {submitting ? 'Saving…' : formMode === 'create' ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deletingTeam} onOpenChange={v => { if (!v) setDeletingTeam(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deletingTeam?.teamName}?</DialogTitle>
            <DialogDescription>
              This removes the team and all associated rosters, draft picks, matches, and trades.
              Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deleteForce}
              onChange={e => setDeleteForce(e.target.checked)}
            />
            Force-delete even if the team has rosters or completed matches
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTeam(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-loss text-surface-base hover:bg-loss/90"
            >
              <Trash2 size={14} />
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: 'win' | 'draw' | 'loss' }) {
  const valueColor =
    accent === 'win' ? 'text-win' :
    accent === 'draw' ? 'text-draw' :
    accent === 'loss' ? 'text-loss' :
    'text-text-primary';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-muted">{label}:</span>
      <span className={`${valueColor} font-medium font-mono`}>{value}</span>
    </div>
  );
}

function FormField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
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

function LogoFormRow({ logoPath, teamColor, teamAbbrev, disabled, onUpload, onRemove }: {
  logoPath: string | null;
  teamColor: string;
  teamAbbrev: string;
  disabled: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <div className="shrink-0 w-16 h-16 rounded-md border border-border-subtle bg-surface-overlay flex items-center justify-center">
        <TeamLogo abbrev={teamAbbrev || '??'} color={teamColor} size="lg" logoPath={logoPath} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title={disabled ? 'Save the team first to upload a logo' : 'Upload a new logo'}
        >
          <Upload size={11} />
          {logoPath ? 'Replace' : 'Upload'}
        </Button>
        {logoPath && !disabled && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onRemove}
            className="text-loss border-loss/30 hover:bg-loss/10"
          >
            <X size={11} />
            Remove
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>
      {disabled && (
        <span className="text-[10px] text-text-muted">
          Save the team first to upload a logo.
        </span>
      )}
    </div>
  );
}

function TeamRow({ team, manager, onUpload, onEdit, onDelete }: {
  team: ApiTeam;
  manager: ApiAuthUser | undefined;
  onUpload: (file: File) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-border-default transition-colors">
      {/* Logo with hover-to-upload overlay */}
      <div className="relative shrink-0 group">
        <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="md" logoPath={team.logoPath} />
        <button
          onClick={() => fileRef.current?.click()}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Upload logo"
        >
          <Upload size={14} className="text-white" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Team info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-text-primary truncate">{team.teamName}</span>
          <Badge variant="outline" className="text-[10px] px-1.5">{team.teamAbbrev}</Badge>
        </div>
        <div className="text-[10px] text-text-muted flex items-center gap-2 mt-0.5">
          <span className="truncate">{team.name || 'No coach'}</span>
          {manager ? (
            <span className="flex items-center gap-1 text-text-secondary">
              <UserCog size={9} />
              {manager.username}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-loss/70">
              <UserCog size={9} />
              No manager
            </span>
          )}
        </div>
      </div>

      {/* Status icons */}
      {team.logoPath ? (
        <ImageIcon size={14} className="text-win shrink-0" />
      ) : (
        <span className="text-[10px] text-text-muted/40 shrink-0">No logo</span>
      )}

      {/* Actions */}
      <Button size="xs" variant="outline" onClick={onEdit} className="shrink-0">
        <Pencil size={11} />
      </Button>
      <Button
        size="xs"
        variant="outline"
        onClick={onDelete}
        className="shrink-0 text-loss border-loss/30 hover:bg-loss/10"
      >
        <Trash2 size={11} />
      </Button>
    </div>
  );
}
