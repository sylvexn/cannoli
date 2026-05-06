import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';

interface SeasonRow {
  id: number;
  seasonNumber: number;
  phase: string;
  archived: boolean;
}

interface Props {
  seasonsList: SeasonRow[];
  onToggleArchive: (seasonId: number, archived: boolean) => void;
}

export function SeasonArchiveSection({ seasonsList, onToggleArchive }: Props) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <AlertTriangle size={12} />
        Season Archive
      </h3>
      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-[11px] text-text-muted">
            Archived seasons are read-only — writes to their leagues require <span className="font-mono">?force=1</span>,
            and tier-list edits are blocked even when leagues are at offseason. Toggle once a season is wrapped up so
            historical standings stay referentially valid.
          </p>
          <div className="space-y-1">
            {seasonsList.length === 0 ? (
              <div className="text-xs text-text-muted text-center py-2">No seasons</div>
            ) : seasonsList.map(s => (
              <div key={s.id} className="flex items-center gap-3 px-2 py-1.5 rounded border border-border-subtle">
                <span className="text-xs font-mono text-text-primary w-16">S{s.seasonNumber}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{s.phase}</Badge>
                {s.archived && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-loss border-loss/30 bg-loss/10">
                    Archived
                  </Badge>
                )}
                <div className="flex-1" />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onToggleArchive(s.id, !s.archived)}
                  className={s.archived ? '' : 'text-loss/80 border-loss/20 hover:bg-loss/10'}
                >
                  {s.archived ? 'Un-archive' : 'Archive'}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
