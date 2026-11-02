import { useNavigate } from 'react-router-dom';
import { ChevronDown, Archive } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
        <span className="h-2 w-2 shrink-0 rounded-full bg-gem" style={active ? { backgroundColor: active.color } : undefined} />
        <span className="min-w-0 truncate font-['Cinzel_Variable',serif] text-sm font-bold tracking-wide">
          {active ? shortName(active) : 'Leagues'}
        </span>
        <ChevronDown size={14} className="shrink-0 text-text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {leagues.map(l => (
          <DropdownMenuItem key={l.id} onClick={() => navigate(`/league/${l.id}`)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="font-['Cinzel_Variable',serif] font-bold">{shortName(l)}</span>
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
