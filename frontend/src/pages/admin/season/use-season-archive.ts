import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface SeasonArchiveRow {
  id: number;
  seasonNumber: number;
  phase: string;
  archived: boolean;
}

/**
 * Drives the read-only season archive list at the bottom of the admin season
 * tab. Fetches all seasons on mount; exposes a toggleArchive action that
 * refreshes after success.
 */
export function useSeasonArchive() {
  const [seasonsList, setSeasonsList] = useState<SeasonArchiveRow[]>([]);

  const refreshSeasons = useCallback(() => {
    api.getSeasons()
      .then(rows => setSeasonsList(rows.map(r => ({
        id: r.id,
        seasonNumber: r.seasonNumber,
        phase: r.phase,
        archived: !!r.archived,
      }))))
      .catch(() => {});
  }, []);

  useEffect(() => { refreshSeasons(); }, [refreshSeasons]);

  const toggleArchive = useCallback(async (seasonId: number, archived: boolean) => {
    try {
      await api.archiveSeason(seasonId, archived);
      toast.success(archived ? 'Season archived' : 'Season un-archived');
      refreshSeasons();
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [refreshSeasons]);

  return { seasonsList, refreshSeasons, toggleArchive };
}
