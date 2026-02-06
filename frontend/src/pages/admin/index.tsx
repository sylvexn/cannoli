import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminUsers } from './admin-users';
import { AdminLeagues } from './admin-leagues';
import { AdminTrades } from './admin-trades';
import { AdminActivityLog } from './admin-activity-log';
import { Users, Globe, ArrowLeftRight, ScrollText } from 'lucide-react';

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-heading text-text-primary">Admin Panel</h1>
        <p className="text-sm text-text-muted">Site-wide configuration and management</p>
      </div>

      <Tabs defaultValue="users">
        <TabsList variant="line">
          <TabsTrigger value="users">
            <Users size={14} />
            Users
          </TabsTrigger>
          <TabsTrigger value="leagues">
            <Globe size={14} />
            Leagues
          </TabsTrigger>
          <TabsTrigger value="trades">
            <ArrowLeftRight size={14} />
            Trades
          </TabsTrigger>
          <TabsTrigger value="activity">
            <ScrollText size={14} />
            Activity Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <AdminUsers />
        </TabsContent>
        <TabsContent value="leagues">
          <AdminLeagues />
        </TabsContent>
        <TabsContent value="trades">
          <AdminTrades />
        </TabsContent>
        <TabsContent value="activity">
          <AdminActivityLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
