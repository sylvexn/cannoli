import { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { LoadingSprite } from '@/components/loading-sprite';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import type { ApiAuthUser } from '@/lib/api';
import { CoachLink } from '@/components/coach-link';
import {
  UserPlus, MoreHorizontal, KeyRound, ShieldCheck, ShieldOff,
  UserX, UserCheck, Copy, Eye, EyeOff, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AdminUsers() {
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'dev' | 'admin' | 'user'>('all');
  const [sortBy, setSortBy] = useState<'username' | 'role' | 'status' | 'created'>('username');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    api.getUsers()
      .then(setUsers)
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false));
  }, []);

  const toggleSort = useCallback((col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }, [sortBy]);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter !== 'all') {
      list = list.filter(u => u.role === roleFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u => u.username.includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a: ApiAuthUser, b: ApiAuthUser) => {
      switch (sortBy) {
        case 'username': return dir * a.username.localeCompare(b.username);
        case 'role': return dir * a.role.localeCompare(b.role);
        case 'status': return dir * (Number(b.active) - Number(a.active));
        case 'created': return dir * ((a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        default: return 0;
      }
    });
  }, [users, search, roleFilter, sortBy, sortDir]);

  async function handleCreate() {
    if (!newUsername.trim()) return;
    try {
      const { user: created, password } = await api.createUser(newUsername.trim(), newRole);
      setUsers(prev => [...prev, { ...created, mustChangePassword: true, active: true, createdAt: new Date().toISOString() }]);
      setGeneratedPassword(password);
      setNewUsername('');
      setNewRole('user');
      toast.success(`User "${created.username}" created`);
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleToggleActive(id: string) {
    const user = users.find(u => u.id === id);
    if (!user) return;
    try {
      await api.updateUser(id, { active: !user.active });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, active: !u.active } : u));
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleToggleRole(id: string) {
    const target = users.find(u => u.id === id);
    if (!target) return;
    const newRole = target.role === 'admin' ? 'user' : 'admin';
    try {
      await api.updateUser(id, { role: newRole });
      setUsers(prev => prev.map(u => u.id === id ? { ...u, role: newRole } : u));
    } catch (err: any) { toast.error(err.message); }
  }

  async function handleResetPassword(user: ApiAuthUser) {
    try {
      const { password } = await api.resetUserPassword(user.id);
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, mustChangePassword: true } : u));
      toast.success(`Password reset for "${user.username}": ${password}`);
    } catch (err: any) { toast.error(err.message); }
  }

  function closeCreateDialog() {
    setCreateOpen(false);
    setNewUsername('');
    setNewRole('user');
    setGeneratedPassword('');
    setShowPassword(false);
  }

  if (loading) {
    return <LoadingSprite label="Loading users..." />;
  }

  return (
    <div className="space-y-3">
      {/* Header: role filter + search + create */}
      <div className="flex items-center gap-3">
        <div className="flex gap-0.5 rounded-md border border-border-subtle overflow-hidden">
          {(['all', 'dev', 'admin', 'user'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={cn(
                'px-2 py-0.5 text-[10px] font-medium transition-colors',
                roleFilter === r
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {r === 'all' ? `All (${users.length})` : r}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-[200px] ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" size={12} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search users..."
            className="pl-7 h-7 text-xs bg-surface-overlay border-border-default"
          />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-neon text-surface-base hover:bg-neon/90 h-7 text-xs">
          <UserPlus size={12} />
          Create
        </Button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-text-muted/50">
        <SortHeader label="User" col="username" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[160px]" />
        <SortHeader label="Role" col="role" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[60px]" />
        <SortHeader label="Active" col="status" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[56px] justify-center" />
        <span className="w-[60px]" />
        <span className="flex-1" />
        <SortHeader label="Created" col="created" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[80px] justify-end" />
        <span className="w-[24px]" />
      </div>

      {/* Compact user list */}
      <div className="divide-y divide-border-subtle/30">
        {filtered.map((user: ApiAuthUser) => (
          <div
            key={user.id}
            className={cn(
              'flex items-center gap-3 px-2 py-1.5 hover:bg-surface-overlay/20 transition-colors rounded',
              !user.active && 'opacity-40',
            )}
          >
            {/* Username — links to public profile + opens hover card */}
            <span className="w-[180px] truncate text-[13px] font-medium">
              <CoachLink
                coach={{
                  username: user.username,
                  displayName: user.displayName,
                  avatarPath: user.avatarPath,
                  primaryColor: user.primaryColor,
                  secondaryColor: user.secondaryColor,
                  tertiaryColor: user.tertiaryColor,
                  role: user.role,
                }}
                showAvatar
                avatarSize="md"
                size="sm"
              />
            </span>

            {/* Role badge */}
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] px-1.5 py-0 h-4 w-[60px] justify-center',
                (user.role === 'admin' || user.role === 'dev')
                  ? 'bg-neon/10 text-neon border-neon/30'
                  : 'text-text-muted border-border-subtle',
              )}
            >
              {user.role}
            </Badge>

            {/* Status dot */}
            <div className="w-[56px] flex justify-center">
              <div
                className={cn('w-1.5 h-1.5 rounded-full', user.active ? 'bg-win' : 'bg-loss')}
                aria-label={user.active ? 'Active' : 'Inactive'}
              />
            </div>

            {/* Must change pw */}
            <span className="w-[60px] text-[9px] text-draw font-mono">
              {user.mustChangePassword ? 'pw reset' : ''}
            </span>

            <span className="flex-1" />

            {/* Created date */}
            <span className="text-[10px] text-text-muted/60 font-mono tabular-nums w-[80px] text-right">
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) : '—'}
            </span>

            {/* Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger className="p-0.5 rounded hover:bg-surface-overlay transition-colors outline-none w-[24px] flex justify-end">
                <MoreHorizontal size={13} className="text-text-muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[170px] w-auto">
                <DropdownMenuItem onClick={() => handleResetPassword(user)}>
                  <KeyRound size={14} />
                  Reset Password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleToggleRole(user.id)}>
                  {user.role === 'admin'
                    ? <><ShieldOff size={14} /> Demote to User</>
                    : <><ShieldCheck size={14} /> Promote to Admin</>
                  }
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleToggleActive(user.id)}
                  variant={user.active ? 'destructive' : 'default'}
                >
                  {user.active
                    ? <><UserX size={14} /> Deactivate</>
                    : <><UserCheck size={14} /> Reactivate</>
                  }
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-text-muted text-center py-4">
            {search ? 'No users match search' : 'No users'}
          </div>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { if (!open) closeCreateDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              The user will be assigned a temporary password and must change it on first login.
            </DialogDescription>
          </DialogHeader>

          {!generatedPassword ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Username</label>
                <Input
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="Enter username"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Role</label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={newRole === 'user' ? 'default' : 'outline'}
                    onClick={() => setNewRole('user')}
                  >
                    User
                  </Button>
                  <Button
                    size="sm"
                    variant={newRole === 'admin' ? 'default' : 'outline'}
                    onClick={() => setNewRole('admin')}
                    className={newRole === 'admin' ? 'bg-neon text-surface-base' : undefined}
                  >
                    Admin
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-win">User created successfully.</p>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Temporary Password</label>
                <div className="flex gap-2">
                  <Input
                    value={generatedPassword}
                    readOnly
                    type={showPassword ? 'text' : 'password'}
                    className="font-mono"
                  />
                  <Button size="icon" variant="outline" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button size="icon" variant="outline" onClick={() => {
                    navigator.clipboard.writeText(generatedPassword);
                    toast.success('Copied to clipboard');
                  }}>
                    <Copy size={14} />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-text-muted">
                Share this password securely. The user must change it on first login.
              </p>
            </div>
          )}

          <DialogFooter>
            {!generatedPassword ? (
              <>
                <Button variant="outline" onClick={closeCreateDialog}>Cancel</Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newUsername.trim()}
                  className="bg-neon text-surface-base hover:bg-neon/90"
                >
                  Create
                </Button>
              </>
            ) : (
              <Button onClick={closeCreateDialog}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({ label, col, active, dir, onSort, className }: {
  label: string;
  col: string;
  active: string;
  dir: 'asc' | 'desc';
  onSort: (col: any) => void;
  className?: string;
}) {
  const isActive = active === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={cn(
        'flex items-center gap-0.5 hover:text-text-secondary transition-colors',
        isActive && 'text-text-secondary',
        className,
      )}
    >
      {label}
      {isActive && (
        <span className="text-[8px]">{dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );
}
