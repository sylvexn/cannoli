import { Newspaper } from 'lucide-react';
import { SidebarNavItem } from './sidebar-nav-item';
import { usePatchNotes } from '@/lib/use-patch-notes';

/** Sidebar link to /patch-notes; badge = patches newer than the user's last visit. */
export function PatchNotesNavItem({ collapsed }: { collapsed: boolean }) {
  const { unread } = usePatchNotes();
  return <SidebarNavItem to="/patch-notes" icon={Newspaper} label="Patch Notes" badge={unread} collapsed={collapsed} />;
}
