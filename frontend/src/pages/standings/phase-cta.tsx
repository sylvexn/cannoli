import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/section-heading';
import { useLeague } from '@/lib/league-context';
import { useFormatDateTime } from '@/lib/format';

const BOX = 'flex items-center justify-between gap-3 flex-wrap rounded-md border border-border-subtle bg-surface-raised px-3 py-2.5';

/** Draft call-to-action for predraft/draft leagues. Works outside a league route (uses league.id). */
export function DraftCta() {
  const league = useLeague();
  const fmt = useFormatDateTime();
  const live = league.season.phase === 'draft';
  const when = league.draftDate && !Number.isNaN(new Date(league.draftDate).getTime())
    ? fmt(league.draftDate, { tzSuffix: true })
    : null;
  return (
    <section aria-label="Draft">
      <SectionHeading meta={live ? 'Draft live' : undefined}>Draft</SectionHeading>
      <div className={BOX}>
        <span className="text-sm text-text-secondary">{live ? 'The draft is underway.' : (when ?? 'Date TBA')}</span>
        <Button nativeButton={false} render={<Link to={`/league/${league.id}/draft`} />}>
          {live ? 'Join draft' : 'Open draft room'}
        </Button>
      </div>
    </section>
  );
}

/** Playoffs panel. There is no standalone playoffs route; the bracket lives on the schedule page. */
export function PlayoffsPanel({ note = 'The bracket is set.' }: { note?: string }) {
  const league = useLeague();
  return (
    <section aria-label="Playoffs">
      <SectionHeading>Playoffs</SectionHeading>
      <div className={BOX}>
        <span className="flex items-center gap-2 text-sm text-text-secondary">
          <Trophy size={14} className="shrink-0 text-gem-ink" /> {note}
        </span>
        <Button nativeButton={false} render={<Link to={`/league/${league.id}/schedule`} />}>View bracket</Button>
      </div>
    </section>
  );
}
