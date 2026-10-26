import { PLAYED_TWICE, STANDINGS, TEAM_BY_ID, TOP_N, pairKey } from './data';

export interface Warning { level: 'warn' | 'info'; text: string }

/** Round-1 pairings for the 6-team layout (matches buildPlayoffMatchups). */
export const R1: [number, number][] = [[3, 6], [4, 5]];

export function validate(order: string[]): Warning[] {
  const out: Warning[] = [];
  const at = (seed: number) => TEAM_BY_ID.get(order[seed - 1])!;
  for (const [a, b] of R1) {
    const A = at(a), B = at(b);
    if (PLAYED_TWICE.has(pairKey(A.id, B.id)))
      out.push({ level: 'warn', text: `Rematch: #${a} ${A.name} vs #${b} ${B.name} already met twice this season.` });
    if (A.division === B.division)
      out.push({ level: 'info', text: `Same division in round 1: #${a} ${A.name} vs #${b} ${B.name} (${A.division}).` });
  }
  const top = order.slice(0, TOP_N);
  const moved = top.filter((id, i) => STANDINGS.indexOf(id) !== i).length;
  if (moved) out.push({ level: 'info', text: `${moved} seeds differ from standings order (manual seeding).` });
  top.forEach((id, i) => {
    const t = TEAM_BY_ID.get(id)!;
    if (STANDINGS.indexOf(id) >= TOP_N)
      out.push({ level: 'warn', text: `${t.name} finished #${STANDINGS.indexOf(id) + 1}, outside the cut line.` });
    const worse = top.slice(0, i).map(o => TEAM_BY_ID.get(o)!).find(o => o.w < t.w);
    if (worse) out.push({ level: 'warn', text: `${t.name} (${t.w}-${t.l}) is seeded below ${worse.name} (${worse.w}-${worse.l}).` });
  });
  return out;
}
