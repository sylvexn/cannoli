import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  UserX, UserCheck, Copy, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';

export function AdminUsers() {
  const [users, setUsers] = useState<ApiAuthUser[]>([]);
  const [loading, setLoading] = useState(true);
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
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Total:</span>
          <span className="text-text-primary font-medium">{users.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Active:</span>
          <span className="text-win font-medium">{activeCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Admins:</span>
          <span className="text-neon font-medium">{adminCount}</span>
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreateOpen(true)} className="bg-neon text-surface-base hover:bg-neon/90">
            <UserPlus size={14} />
            Create User
          </Button>
        </div>
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(user => (
                <TableRow key={user.id} className={!user.active ? 'opacity-50' : undefined}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>
                    <Badge
                      variant={(user.role === 'admin' || user.role === 'dev') ? 'default' : 'outline'}
                      className={(user.role === 'admin' || user.role === 'dev') ? 'bg-neon/15 text-neon border-neon/30' : undefined}
                    >
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={user.active
                      ? 'border-win/30 text-win bg-win/10'
                      : 'border-loss/30 text-loss bg-loss/10'
                    }>
                      {user.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.mustChangePassword && (
                      <span className="text-xs text-draw">Must change</span>
                    )}
                  </TableCell>
                  <TableCell className="text-text-muted text-xs">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="p-1 rounded hover:bg-surface-overlay transition-colors outline-none">
                        <MoreHorizontal size={14} />
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
