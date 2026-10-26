import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { DeploysPanel } from './deploys-panel';
import { LogTail } from './log-tail';

/** /admin/dev — dev role only (mirrors the server-side requireDev guard). */
export function DevConsolePage() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (user?.role !== 'dev') return <Navigate to="/admin" replace />;
  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-mono font-bold tracking-tight uppercase">
          <span className="text-win">Dev</span>{' '}<span>Console</span>
        </h2>
        <p className="text-[11px] text-text-muted">Deploy health and live logs.</p>
      </div>
      <DeploysPanel />
      <LogTail />
    </div>
  );
}
