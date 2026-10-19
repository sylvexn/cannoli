import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Trophy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { api } from '@/lib/api';

type SeasonLeague = Awaited<ReturnType<typeof api.getSeasonLeagues>>[number];
type Season = Awaited<ReturnType<typeof api.getSeasons>>[number];

/**
 * Past-teams browser: any real team from any season/league with its results.
 * A row opens the read-only preview, where it can be cloned into an editable team.
 */
export function PastTeams() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [leagues, setLeagues] = useState<SeasonLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getSeasons().then(s => {
      if (cancelled) return;
      setSeasons(s);
      setSeasonId(s[0]?.id ?? null);
      if (s.length === 0) setLoading(false);
    }).catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (seasonId == null) return;
    let cancelled = false;
    setLoading(true);
    api.getSeasonLeagues(seasonId)
      .then(l => { if (!cancelled) { setLeagues(l); setError(false); } })
      .catch(() => { if (!cancelled) { setLeagues([]); setError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seasonId]);

  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => leagues.map(l => ({
    ...l,
    teams: l.teams.filter(t => !needle
      || t.teamName.toLowerCase().includes(needle)
      || t.coachName.toLowerCase().includes(needle)
      || (t.roster ?? []).some(r => r.name.toLowerCase().includes(needle))),
  })).filter(l => l.teams.length > 0), [leagues, needle]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={seasonId == null ? '' : String(seasonId)} onValueChange={v => { if (v) setSeasonId(Number(v)); }}>
          <SelectTrigger size="sm" aria-label="Season" className="w-36">
            <SelectValue placeholder="Season">{seasonId != null ? `Season ${seasons.find(s => s.id === seasonId)?.seasonNumber ?? ''}` : 'Season'}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {seasons.map(s => <SelectItem key={s.id} value={String(s.id)}>Season {s.seasonNumber}{s.archived ? ' (archived)' : ''}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="relative flex-1 basis-56 max-w-sm min-w-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by team, coach or Pokemon" className="pl-8 h-8" />
        </div>
      </div>

      {loading ? <div className="p-8 text-sm text-text-muted">Loading...</div>
        : error ? <div className="p-8 text-sm text-loss">Couldn't load past teams.</div>
        : filtered.length === 0 ? <div className="p-8 text-sm text-text-muted text-center">No teams match.</div>
        : filtered.map(l => (
          <section key={l.id} className="rounded-lg border border-border-default overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-overlay/40 border-b border-border-subtle">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              <h3 className="text-sm font-heading font-semibold">{l.name}</h3>
              <span className="text-[10px] font-mono text-text-muted ml-auto">{l.teams.length} teams</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-muted text-left">
                    <th className="px-3 py-1.5 font-medium">Team</th>
                    <th className="px-2 py-1.5 font-medium">Finish</th>
                    <th className="px-2 py-1.5 font-medium text-right">W-L</th>
                    <th className="px-2 py-1.5 font-medium text-right hidden sm:table-cell">Kills</th>
                    <th className="px-2 py-1.5 font-medium hidden md:table-cell">Roster</th>
                  </tr>
                </thead>
                <tbody>
                  {l.teams.map(t => (
                    <tr key={t.id} className="border-t border-border-subtle hover:bg-surface-overlay/30 transition-colors">
                      <td className="px-3 py-1.5 min-w-40">
                        <Link to={`/draft-center/past/${l.id}/${t.id}`} className="font-mono font-semibold hover:text-neon hover:underline">{t.teamName}</Link>
                        <div className="text-[10px] text-text-muted truncate">{t.coachName}</div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {l.champion === t.id && <Trophy size={11} className="inline text-amber-400 mr-1 -mt-0.5" />}
                        <span className={l.champion === t.id ? 'text-amber-400' : 'text-text-secondary'}>{t.finishLabel ?? (t.finishPosition ? `#${t.finishPosition}` : '-')}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{t.record ? `${t.record.wins}-${t.record.losses}` : '-'}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums hidden sm:table-cell">{t.record?.kills ?? '-'}</td>
                      <td className="px-2 py-1 hidden md:table-cell">
                        <div className="flex">{(t.roster ?? []).map(r => <PokemonSprite key={r.name} name={r.name} size="xs" />)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  );
}
