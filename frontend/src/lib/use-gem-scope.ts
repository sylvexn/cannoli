import { useEffect } from 'react';
import { leagueGem } from '@/lib/constants';

/** Tints the whole app with a league's gem by setting data-gem on <html>
 *  (index.css maps it to --gem). Falls back to sapphire. */
export function useGemScope(leagueId: string | null | undefined) {
  const gem = leagueId ? leagueGem(leagueId) : 'sapphire';
  useEffect(() => {
    document.documentElement.dataset.gem = gem;
  }, [gem]);
}
