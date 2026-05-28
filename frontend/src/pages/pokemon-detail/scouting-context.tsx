import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LeagueHistory } from './league-history';
import { Users, Swords, History, Clapperboard, Hourglass } from 'lucide-react';

interface ScoutingContextProps {
  pokemonName: string;
}

/**
 * Lower full-width strip on the Pokemon detail page. Four columns of
 * scouting-context cards. The 1st, 2nd and 4th are themed placeholders
 * pending the `/api/pokemon/:name/scouting-context` backend endpoint;
 * the 3rd renders the existing LeagueHistory component (current rosters)
 * in embedded mode.
 */
export function ScoutingContext({ pokemonName }: ScoutingContextProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <PlaceholderCard
        icon={<Users size={14} className="text-neon" />}
        title="Often Paired With"
        body="Frequent teammates from past league matches will appear here once the match-history miner lands."
      />
      <PlaceholderCard
        icon={<Swords size={14} className="text-loss" />}
        title="Common Counters"
        body="Pokemon that have answered this one across the league will surface here based on KO data."
      />
      <Card className="bg-surface-raised border-border-default">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
            <History size={14} className="text-draw" />
            Historical Owners
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <LeagueHistory pokemonName={pokemonName} variant="embedded" />
        </CardContent>
      </Card>
      <PlaceholderCard
        icon={<Clapperboard size={14} className="text-pink" />}
        title="Recent League Battles"
        body="Replays where this Pokemon featured will be linked here when the scouting feed lands."
      />
    </div>
  );
}

interface PlaceholderCardProps {
  icon: ReactNode;
  title: string;
  body: string;
}

function PlaceholderCard({ icon, title, body }: PlaceholderCardProps) {
  return (
    <Card className="bg-surface-raised border-border-default">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-heading font-semibold uppercase tracking-wider text-text-primary flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-overlay/30 px-3 py-4 flex flex-col items-start gap-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            <Hourglass size={10} />
            Coming soon
          </div>
          <p className="text-xs text-text-muted leading-snug">{body}</p>
        </div>
      </CardContent>
    </Card>
  );
}
