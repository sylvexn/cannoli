import { Link } from 'react-router-dom';
import { Shield, MessageSquare, Activity, Settings, ChevronRight } from 'lucide-react';

/**
 * Admin strip — composable, sits ABOVE the role header for admin/dev users.
 * Slim quick-links rail; doesn't take over the page. Clicking jumps to
 * common admin destinations the user opens repeatedly. Avoids extra fetches
 * (no pending-feedback count etc.) so it stays lightweight to render.
 */
export function HeaderAdmin() {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-pink/20 bg-pink/5 text-xs">
      <Shield size={12} className="text-pink shrink-0" />
      <span className="font-mono uppercase tracking-wider text-pink shrink-0">Admin</span>
      <span className="text-text-muted shrink-0">·</span>
      <div className="flex items-center gap-1 flex-wrap min-w-0 flex-1">
        <AdminPill to="/admin/activity" icon={<Activity size={11} />}>Activity</AdminPill>
        <AdminPill to="/admin/feedback" icon={<MessageSquare size={11} />}>Feedback</AdminPill>
        <AdminPill to="/admin/settings" icon={<Settings size={11} />}>Site Settings</AdminPill>
      </div>
      <Link
        to="/admin"
        className="inline-flex items-center gap-1 text-text-muted hover:text-pink transition-colors text-[11px]"
      >
        Open admin
        <ChevronRight size={11} />
      </Link>
    </div>
  );
}

function AdminPill({
  to, icon, children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-overlay/40 text-text-secondary hover:bg-pink/10 hover:text-pink transition-colors text-[11px]"
    >
      {icon}
      {children}
    </Link>
  );
}
