import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useFormatDate } from '@/lib/format';
import { IdCard } from 'lucide-react';

export function AccountTab() {
  const { user } = useAuth();
  const fmtDate = useFormatDate();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IdCard size={16} />
          Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs text-text-muted">Username</label>
          <Input value={user?.username ?? ''} disabled />
          <p className="text-[11px] text-text-muted">Your login identifier. Only an admin can change this.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Role</label>
            <div>
              <Badge variant={user?.role === 'admin' || user?.role === 'dev' ? 'default' : 'outline'}>
                {user?.role}
              </Badge>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">Member since</label>
            <p className="text-xs text-text-primary font-mono">
              {user?.createdAt ? fmtDate(user.createdAt) : '—'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
