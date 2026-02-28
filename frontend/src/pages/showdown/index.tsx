import { useSearchParams } from 'react-router-dom';
import { PlayTab } from './play-tab';
import { ArenaTab } from './arena-tab';

const TABS = ['play', 'arena'] as const;
type Tab = typeof TABS[number];

export function ShowdownPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = tabParam === 'arena' ? 'arena' : 'play';

  const setTab = (tab: Tab) => {
    setSearchParams(tab === 'play' ? {} : { tab });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 pb-3 flex-shrink-0">
        <h1 className="font-mono text-lg font-bold uppercase tracking-wider mr-4">
          <span className="text-orange-400">Showdown</span>
        </h1>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-orange-400/15 text-orange-400'
                : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
            }`}
          >
            {tab === 'play' ? 'Play' : 'Arena'}
          </button>
        ))}
      </div>

      {/* Tab content — fills remaining height */}
      <div className="flex-1 min-h-0">
        {activeTab === 'play' ? <PlayTab /> : <ArenaTab />}
      </div>
    </div>
  );
}
