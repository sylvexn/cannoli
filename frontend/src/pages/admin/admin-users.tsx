import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import {
  UserPlus, MoreHorizontal, KeyRound, ShieldCheck, ShieldOff,
  UserX, UserCheck, Copy, Eye, EyeOff, Search, ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AdminUsers() {
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(u => u.username.includes(q) || u.role.includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'username': return dir * a.username.localeCompare(b.username);
        case 'role': return dir * a.role.localeCompare(b.role);
        case 'status': return dir * (Number(b.active) - Number(a.active));
        case 'created': return dir * ((a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        default: return 0;
      }
    });
  }, [users, search, sortBy, sortDir]);

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

  const activeCount = users.filter(u => u.active).length;
  const adminCount = users.filter(u => (u.role === 'admin' || u.role === 'dev') && u.active).length;

  if (loading) {
    return <div className="text-sm text-text-muted py-8 text-center">Loading users...</div>;
  }

  return (
    <div className="space-y-3">
      {/* Header: stats + search + create */}
      <div className="flex items-center gap-3">
        <div className="flex gap-3 text-xs text-text-muted">
          <span>{users.length} total</span>
          <span className="text-win">{activeCount} active</span>
          <span className="text-neon">{adminCount} admin</span>
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
        <SortHeader label="User" col="username" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[120px]" />
        <SortHeader label="Role" col="role" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[48px]" />
        <SortHeader label="St" col="status" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[14px]" />
        <span className="w-[44px]" />
        <span className="flex-1" />
        <SortHeader label="Created" col="created" active={sortBy} dir={sortDir} onSort={toggleSort} className="w-[70px] text-right" />
        <span className="w-[20px]" />
      </div>

      {/* Compact user list */}
      <div className="divide-y divide-border-subtle/30">
        {filtered.map(user => (
          <div
            key={user.id}
            className={cn(
              'flex items-center gap-3 px-2 py-1.5 hover:bg-surface-overlay/20 transition-colors rounded',
              !user.active && 'opacity-40',
            )}
          >
            {/* Username */}
            <span className="text-[13px] font-medium text-text-primary w-[120px] truncate">
              {user.username}
            </span>

            {/* Role badge */}
            <Badge
              variant="outline"
              className={cn(
                'text-[10px] px-1.5 py-0 h-4 w-[48px] justify-center',
                (user.role === 'admin' || user.role === 'dev')
                  ? 'bg-neon/10 text-neon border-neon/30'
                  : 'text-text-muted border-border-subtle',
              )}
            >
              {user.role}
            </Badge>

            {/* Status dot */}
            <div className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              user.active ? 'bg-win' : 'bg-loss',
            )} />

            {/* Must change pw */}
            {user.mustChangePassword && (
              <span className="text-[9px] text-draw font-mono">pw reset</span>
            )}

            <span className="flex-1" />

            {/* Created date */}
            <span className="text-[10px] text-text-muted/60 font-mono tabular-nums w-[70px] text-right">
              {user.createdAt ? new Date(user.createdAt).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) : '—'}
            </span>

            {/* Actions */}
            <DropdownMenu>
              <DropdownMenuTrigger className="p-0.5 rounded hover:bg-surface-overlay transition-colors outline-none">
                <MoreHorizontal size={13} className="text-text-muted" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
