import { Link, useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLogo } from '@/components/team-logo';
import { PokemonSprite } from '@/components/pokemon-sprite';
import { pokemonRoute } from '@/lib/pokemon-route';
import { ArrowRight, Repeat, UserPlus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FullLeagueData, TransactionRow, TeamRow } from '../types';

/** League's transaction ledger — trades, F/A pickups, tera changes.
 *  Renders as a single timeline grouped by week. */
export function TransactionsTab({ data }: { data: FullLeagueData }) {
  const teamMap = new Map(data.teams.map(t => [t.id, t]));

  if (data.transactions.length === 0) {
    return (
      <div className="text-text-muted text-sm py-12 text-center italic">
        No transactions recorded for this league.
      </div>
    );
  }

  const byWeek = new Map<number, TransactionRow[]>();
  for (const t of data.transactions) {
    if (!byWeek.has(t.week)) byWeek.set(t.week, []);
    byWeek.get(t.week)!.push(t);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      {weeks.map(w => (
        <Card key={w} className="bg-surface-raised border-border-default">
          <CardContent className="p-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
              Week {w} · {byWeek.get(w)!.length} transaction{byWeek.get(w)!.length === 1 ? '' : 's'}
            </div>
            <div className="space-y-1">
              {byWeek.get(w)!.map(t => (
                <TransactionRowDisplay key={t.id} txn={t} teamMap={teamMap} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TransactionRowDisplay({ txn, teamMap }: { txn: TransactionRow; teamMap: Map<string, TeamRow> }) {
  const team = teamMap.get(txn.teamId);
  const other = txn.otherTeamId ? teamMap.get(txn.otherTeamId) : null;
  const { seasonId, leagueId } = useParams<{ seasonId: string; leagueId: string }>();

  const TypeIcon = txn.type === 'trade' ? Repeat : txn.type === 'fa' ? UserPlus : Sparkles;

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[11px] rounded hover:bg-surface-overlay/40 transition-colors">
      <Badge
        variant="outline"
        className={cn(
          'text-[9px] uppercase tracking-wider px-1 py-0 h-4 shrink-0',
          txn.type === 'trade' ? 'border-purple-400/40 text-purple-400'
          : txn.type === 'fa' ? 'border-emerald-400/40 text-emerald-400'
          : 'border-cyan-400/40 text-cyan-400',
        )}
      >
        <TypeIcon size={9} className="mr-0.5" />
        {txn.type === 'fa' ? 'F/A' : txn.type === 'tera_change' ? 'Tera' : 'Trade'}
      </Badge>

      {team && (
        <Link
          to={`/archive/${seasonId}/${leagueId}/${team.id}`}
          className="flex items-center gap-1 hover:text-text-primary"
        >
          <TeamLogo abbrev={team.teamAbbrev} color={team.teamColor} size="sm" />
          <span className="text-text-secondary">{team.teamAbbrev}</span>
        </Link>
      )}

      {/* What the team gave up (Pokemon out) */}
      {txn.pokemonOut && (
        <div className="flex items-center gap-1 text-loss">
          <span className="font-mono text-[10px]">−</span>
          <PokemonSprite name={txn.pokemonOut} size="xs" />
          <Link
            to={pokemonRoute(txn.pokemonOut)}
            className="hover:underline truncate"
            onClick={e => e.stopPropagation()}
          >
            {txn.pokemonOut}
          </Link>
          {txn.pointsOut != null && <span className="font-mono text-[9px] text-text-muted">{txn.pointsOut}pt</span>}
        </div>
      )}

      {txn.pokemonIn && (
        <div className="flex items-center gap-1 text-win">
          <ArrowRight size={10} className="text-text-muted" />
          <PokemonSprite name={txn.pokemonIn} size="xs" />
          <Link
            to={pokemonRoute(txn.pokemonIn)}
            className="hover:underline truncate"
            onClick={e => e.stopPropagation()}
          >
            {txn.pokemonIn}
          </Link>
          {txn.pointsIn != null && <span className="font-mono text-[9px] text-text-muted">{txn.pointsIn}pt</span>}
        </div>
      )}

      {txn.teraPokemon && (
        <div className="flex items-center gap-1 text-purple-400">
          <PokemonSprite name={txn.teraPokemon} size="xs" />
          <span>{txn.teraPokemon}</span>
        </div>
      )}

      {other && (
        <div className="ml-auto flex items-center gap-1 text-text-muted">
          <span className="text-[9px]">w/</span>
          <Link
            to={`/archive/${seasonId}/${leagueId}/${other.id}`}
            className="flex items-center gap-1 hover:text-text-primary"
          >
            <TeamLogo abbrev={other.teamAbbrev} color={other.teamColor} size="sm" />
            <span>{other.teamAbbrev}</span>
          </Link>
        </div>
      )}
    </div>
  );
}
