import { useNavigate } from 'react-router-dom';
import { ChevronDown, Archive } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { LeagueNameSans } from '@/components/league-name';
import { gemHex } from '@/lib/use-gem-scope';
import type { useAppData } from '@/lib/app-data-context';

type League = ReturnType<typeof useAppData>['leagues'][number];

export const shortName = (l: League) => l.name.replace(' League', '');

export function LeagueSwitcher({ leagues, active }: { leagues: League[]; active: League | null }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch league"
        className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-text-primary transition-colors hover:bg-surface-overlay/60 outline-none focus-visible:ring-2 focus-visible:ring-gem/60 data-popup-open:bg-surface-overlay"
      >
        {active
          ? <LeagueNameSans name={shortName(active)} color={gemHex(active.id)} />
          : <span className="text-sm font-semibold">Leagues</span>}
        <ChevronDown size={14} className="shrink-0 text-text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {leagues.map(l => (
          <DropdownMenuItem key={l.id} onClick={() => navigate(`/league/${l.id}`)}>
            <LeagueNameSans name={shortName(l)} color={gemHex(l.id)} />
            {l.id === active?.id && <span className="ml-auto text-[11px] text-text-muted">current</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/archive')}>
          <Archive size={14} /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
