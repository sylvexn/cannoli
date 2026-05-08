import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Archive } from 'lucide-react';
import { useAppData } from '@/lib/app-data-context';
import { ArchiveSeasonDialog } from './archive-season-dialog';

interface SeasonRow {
  id: number;
  seasonNumber: number;
  phase: string;
  archived: boolean;
}

interface Props {
  seasonsList: SeasonRow[];
  onToggleArchive: (seasonId: number, archived: boolean) => void;
  onArchiveCeremony: (seasonId: number) => Promise<unknown>;
}

export function SeasonArchiveSection({ seasonsList, onToggleArchive, onArchiveCeremony }: Props) {
  const [dialogSeason, setDialogSeason] = useState<SeasonRow | null>(null);
  const [busy, setBusy] = useState(false);
  const { leagues } = useAppData();

  const leagueCountForSeason = (seasonId: number) =>
    leagues.filter(l => l.season?.id === `s${seasonsList.find(s => s.id === seasonId)?.seasonNumber ?? -1}`).length || 3;

  const handleArchive = async () => {
    if (!dialogSeason) return;
    setBusy(true);
    try {
      await onArchiveCeremony(dialogSeason.id);
      setDialogSeason(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
        <AlertTriangle size={12} />
        Season Archive
      </h3>
      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-[11px] text-text-muted">
            Archiving locks a season as historical (writes to its leagues require <span className="font-mono">?force=1</span>),
            forces every league to <span className="font-mono">offseason</span>, and mints auto-pins for the champion,
            regular-season #1, MVPs, single-game high score, best draft value, and most sweeps. Re-running is safe.
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
                {s.archived ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onToggleArchive(s.id, false)}
                  >
                    Un-archive
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => setDialogSeason(s)}
                    className="border-purple-400/40 text-purple-400 hover:bg-purple-400/10"
                  >
                    <Archive size={11} className="mr-1" />
                    Archive Season
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {dialogSeason && (
        <ArchiveSeasonDialog
          open={!!dialogSeason}
          onClose={() => !busy && setDialogSeason(null)}
          seasonNumber={dialogSeason.seasonNumber}
          leagueCount={leagueCountForSeason(dialogSeason.id)}
          onConfirm={handleArchive}
          busy={busy}
        />
      )}
    </div>
  );
}
