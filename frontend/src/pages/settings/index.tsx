import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { User, IdCard, Sliders, Lock } from 'lucide-react';
import { AccountTab } from './account-tab';
import { ProfileTab } from './profile-tab';
import { PreferencesTab } from './preferences-tab';
import { SecurityTab } from './security-tab';

const TABS = [
  { value: 'profile', label: 'Profile', icon: User },
  { value: 'account', label: 'Account', icon: IdCard },
  { value: 'preferences', label: 'Preferences', icon: Sliders },
  { value: 'security', label: 'Security', icon: Lock },
] as const;

type TabValue = typeof TABS[number]['value'];

export function UserSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = searchParams.get('tab');
  const active: TabValue = TABS.some(t => t.value === initial) ? (initial as TabValue) : 'profile';

  function setActive(v: string) {
    const next = new URLSearchParams(searchParams);
    if (v === 'profile') next.delete('tab');
    else next.set('tab', v);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-neon">User</span>{' '}
          <span className="text-text-primary">Settings</span>
        </h1>
        <p className="text-sm text-text-muted">Manage your profile, account, and preferences</p>
      </div>

      <Tabs value={active} onValueChange={(v) => setActive(v as string)}>
        <div className="md:grid md:grid-cols-[200px_1fr] md:gap-6">
          {/* Tab list — top bar on mobile, vertical rail on desktop */}
          <TabsList
            variant="line"
            className="w-full md:flex-col md:items-stretch md:h-fit md:gap-0.5 md:p-1 md:bg-surface-overlay/30 md:rounded-lg md:sticky md:top-4"
          >
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="md:justify-start md:gap-2 md:px-3 md:py-2 text-xs uppercase tracking-wider font-semibold md:data-active:bg-neon/10 md:data-active:text-neon"
                >
                  <Icon size={14} />
                  <span className="hidden md:inline">{t.label}</span>
                  <span className="md:hidden">{t.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="min-w-0 mt-4 md:mt-0">
            <TabsContent value="profile"><ProfileTab /></TabsContent>
            <TabsContent value="account"><AccountTab /></TabsContent>
            <TabsContent value="preferences"><PreferencesTab /></TabsContent>
            <TabsContent value="security"><SecurityTab /></TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
