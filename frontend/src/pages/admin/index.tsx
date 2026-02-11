import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminUsers } from './admin-users';
import { AdminLeagues } from './admin-leagues';
import { AdminTrades } from './admin-trades';
import { AdminActivityLog } from './admin-activity-log';
import { AdminMoveCategories } from './admin-move-categories';
import { AdminSeason } from './admin-season';
import { AdminTierList } from './admin-tier-list';
import { AdminSiteSettings } from './admin-site-settings';
import { Users, Globe, ArrowLeftRight, ScrollText, Swords, CalendarCog, List, Settings } from 'lucide-react';

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-mono font-bold tracking-tight uppercase">
          <span className="text-loss">Admin</span>
          <span className="text-text-primary ml-1">Panel</span>
        </h1>
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
          <TabsTrigger value="season">
            <CalendarCog size={14} />
            Season
          </TabsTrigger>
          <TabsTrigger value="tiers">
            <List size={14} />
            Tier List
          </TabsTrigger>
          <TabsTrigger value="moves">
            <Swords size={14} />
            Move Categories
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings size={14} />
            Site Settings
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
        <TabsContent value="season">
          <AdminSeason />
        </TabsContent>
        <TabsContent value="tiers">
          <AdminTierList />
        </TabsContent>
        <TabsContent value="moves">
          <AdminMoveCategories />
        </TabsContent>
        <TabsContent value="settings">
          <AdminSiteSettings />
        </TabsContent>
        <TabsContent value="activity">
          <AdminActivityLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
