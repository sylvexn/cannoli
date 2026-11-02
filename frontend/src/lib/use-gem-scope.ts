import { useEffect } from 'react';
import { leagueGem } from '@/lib/constants';

/** Hex for each gem, mirrored from index.css (for SVG/canvas that can't read --gem). */
export const GEM_HEX: Record<string, string> = { sapphire: '#3d7bff', ruby: '#ff3b5c', emerald: '#19c37d' };
export const gemHex = (leagueId: string | null | undefined) => GEM_HEX[leagueId ? leagueGem(leagueId) : 'sapphire'] ?? GEM_HEX.sapphire;

/** Tints the whole app with a league's gem by setting data-gem on <html>
 *  (index.css maps it to --gem). Falls back to sapphire. */
export function useGemScope(leagueId: string | null | undefined) {
  const gem = leagueId ? leagueGem(leagueId) : 'sapphire';
  useEffect(() => {
    document.documentElement.dataset.gem = gem;
  }, [gem]);
}
