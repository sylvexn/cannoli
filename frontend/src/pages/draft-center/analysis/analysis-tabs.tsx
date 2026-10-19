import { useMemo } from 'react';
import { BarChart3, Gauge, Grid3X3, LayoutDashboard, Swords } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatsTable } from '@/pages/matchup-center/tabs/stats-tab';
import { teamToRoster } from '@/lib/draft-center/roster';
import { useLocalStorageState } from '@/lib/use-local-storage-state';
import type { Ruleset } from '@/lib/draft-center/ruleset';
import type { DcMon } from '@/lib/draft-center/types';
import { InfoPanel } from './info-panel';
import { TypeChartPanel } from './typechart-panel';
import { SpeedPanel } from './speed-panel';
import { RolesPanel } from './roles-panel';

type Tab = 'overview' | 'types' | 'stats' | 'speed' | 'roles';

/** The five analysis views, shared by the editor, past-team preview and shared-link page. */
export function AnalysisTabs({ roster, ruleset }: { roster: DcMon[]; ruleset: Ruleset }) {
  const [tab, setTab] = useLocalStorageState<Tab>('cannoli.draftCenter.tab', 'overview');
  const rosterPokemon = useMemo(() => teamToRoster(roster, ruleset), [roster, ruleset]);

  return (
    <Tabs value={tab} onValueChange={v => setTab(v as Tab)} className="flex flex-col min-w-0">
      <TabsList variant="line" className="overflow-x-auto max-w-full">
        <TabsTrigger value="overview"><LayoutDashboard size={14} />Overview</TabsTrigger>
        <TabsTrigger value="types"><Grid3X3 size={14} />Type Chart</TabsTrigger>
        <TabsTrigger value="stats"><BarChart3 size={14} />Stats</TabsTrigger>
        <TabsTrigger value="speed"><Gauge size={14} />Speed</TabsTrigger>
        <TabsTrigger value="roles"><Swords size={14} />Roles</TabsTrigger>
      </TabsList>
      <div className="mt-3 min-w-0">
        <TabsContent value="overview"><InfoPanel roster={roster} ruleset={ruleset} /></TabsContent>
        <TabsContent value="types"><TypeChartPanel roster={roster} ruleset={ruleset} /></TabsContent>
        <TabsContent value="stats">
          <div className="max-w-2xl">
            <StatsTable team={rosterPokemon} side="a" />
          </div>
        </TabsContent>
        <TabsContent value="speed"><SpeedPanel roster={roster} ruleset={ruleset} /></TabsContent>
        <TabsContent value="roles"><RolesPanel roster={roster} ruleset={ruleset} /></TabsContent>
      </div>
    </Tabs>
  );
}
