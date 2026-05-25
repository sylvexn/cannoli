import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';

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
 *
 * Pass `refreshLeagues` so a successful archive ceremony also refreshes the
 * app-wide league cache — otherwise the rest of the running app (league
 * pages, admin views) keeps the stale `archived: false` until manual
 * reload, and the read-only badge doesn't appear immediately.
 */
export function useSeasonArchive(refreshLeagues?: () => void) {
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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  }, [refreshSeasons]);

  /**
   * Full archive ceremony — only meaningful when archiving (not un-archiving).
   * Returns the awards summary so the UI can surface what was minted.
   */
  const archiveCeremony = useCallback(async (seasonId: number) => {
    try {
      const result = await api.archiveSeasonCeremony(seasonId);
      const totalNew = result.newAwards.reduce((s, l) => s + l.awarded.length, 0);
      const totalExisting = result.existingAwards.reduce((s, l) => s + l.awarded, 0);
      toast.success(
        `Season ${result.seasonNumber} archived — ${totalExisting + totalNew} pins minted across ${result.leagues} league${result.leagues === 1 ? '' : 's'}`,
      );
      refreshSeasons();
      // Also refresh app-wide league data so league pages immediately reflect
      // the new archived flag (read-only badge, write-blocked banners).
      refreshLeagues?.();
      return result;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
      throw err;
    }
  }, [refreshSeasons, refreshLeagues]);

  return { seasonsList, refreshSeasons, toggleArchive, archiveCeremony };
}
