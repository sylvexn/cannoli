import { Bell, EyeOff, Hourglass, Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BracketPreview } from './bracket-preview';
import { notificationFor } from './publish-dialog';

const Frame = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">{label}</div>
    {children}
  </div>
);

/** Screen 4: what a coach sees on the standings Playoffs view while the bracket is a draft. */
export function HiddenState() {
  return (
    <Frame label="Coach view - standings > Playoffs, bracket still a draft">
      <div className="rounded-lg border border-dashed border-border-default py-14 px-4 text-center space-y-2">
        <Hourglass size={22} className="mx-auto text-text-muted" />
        <div className="text-sm font-medium text-text-primary">Playoff bracket coming soon</div>
        <p className="text-xs text-text-muted max-w-sm mx-auto">
          The regular season is over. Staff are finalising seeding - you'll get a notification the moment the bracket is published.
        </p>
      </div>
      <p className="text-[11px] text-text-muted flex items-center gap-1.5">
        <EyeOff size={11} /> Same empty state as today's "Playoff bracket not yet available", with better copy. Staff see a "Draft - not visible to coaches" banner above their copy.
      </p>
    </Frame>
  );
}

/** Screen 3: bell notification + public bracket after publish. */
export function PublishedState({ order, mySeed }: { order: string[]; mySeed: number }) {
  const n = notificationFor(order, mySeed);
  return (
    <div className="space-y-5">
      <Frame label={`Coach view - bell notification (you are the #${mySeed} seed)`}>
        <div className="max-w-sm rounded-lg border border-border-default bg-surface-raised shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle text-xs font-medium text-text-primary">
            <Bell size={12} /> Notifications <Badge className="h-4 px-1 text-[9px] bg-pink text-surface-base">1</Badge>
          </div>
          <a href="#" onClick={e => e.preventDefault()} className="flex gap-2 px-3 py-2.5 hover:bg-surface-overlay/50">
            <Trophy size={14} className="text-pink mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-text-primary">{n.title}</span>
              <span className="block text-[11px] text-text-secondary">{n.body}</span>
              <span className="block text-[10px] text-text-muted mt-0.5">just now - links to the standings Playoffs view</span>
            </span>
          </a>
        </div>
      </Frame>
      <Frame label="Public bracket (visible to everyone)">
        <BracketPreview order={order} />
      </Frame>
    </div>
  );
}
