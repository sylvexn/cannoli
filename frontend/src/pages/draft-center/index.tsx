import { Outlet } from 'react-router-dom';
import { DraftCenterProvider } from '@/lib/draft-center/store';

export { DraftCenterHome } from './home';
export { TeamEditorPage } from './editor';
export { PastTeamPage } from './past-team';
export { SharedTeamPage } from './shared-page';

/** Shell for every /draft-center route: shared team store + page title. */
export function DraftCenterLayout() {
  return (
    <DraftCenterProvider>
      <div className="flex flex-col gap-3 min-w-0">
        <h1 className="text-2xl font-mono font-bold tracking-tight uppercase">
          <span className="text-emerald-400">Draft</span>{' '}
          <span className="text-text-primary">Center</span>
        </h1>
        <Outlet />
      </div>
    </DraftCenterProvider>
  );
}
