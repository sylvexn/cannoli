/**
 * Pin icon picker — searchable grid of curated lucide icons.
 *
 * We don't expose the entire lucide catalog (1400+ icons) — that's
 * overwhelming and most are irrelevant to pins/achievements. The list below
 * is the curated ~80 most-likely-useful icons across the categories we care
 * about (rank/award, combat/skill, weather, status, motion, geometry).
 *
 * Custom search: any lucide icon name a user types is rendered if it
 * resolves; the visible grid stays focused on the curated list.
 */
import { useMemo, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type LucideIconComponent = React.ComponentType<{ size?: number | string; className?: string; color?: string; strokeWidth?: number }>;
const LUCIDE_MAP = LucideIcons as unknown as Record<string, LucideIconComponent>;

/**
 * Curated set ordered roughly from "trophy/career" through to "arbitrary
 * imagery you might tag a custom community pin with". Exported so the dialog
 * can default to RECENT_LUCIDE_NAMES[0] for new defs.
 */
export const RECENT_LUCIDE_NAMES: string[] = [
  // Award / trophy / status
  'Trophy', 'Crown', 'Medal', 'Award', 'Star', 'Sparkles', 'Gem', 'Badge',
  'BadgeCheck', 'Heart', 'Diamond', 'Gift',
  // Combat / skill
  'Swords', 'Sword', 'Shield', 'ShieldCheck', 'Target', 'Crosshair', 'Bomb',
  'Rocket', 'Flag', 'Anchor',
  // Weather / nature
  'Flame', 'Zap', 'Snowflake', 'Sun', 'Moon', 'Cloud', 'CloudLightning',
  'Wind', 'Droplet', 'Leaf', 'Sprout',
  // Mechanics
  'Crown', 'Skull', 'Ghost', 'Bone', 'Bug', 'Spider',
  // Motion
  'Activity', 'TrendingUp', 'TrendingDown', 'RefreshCw', 'Repeat', 'Recycle',
  'Timer', 'Clock', 'Hourglass',
  // Communication / community
  'Megaphone', 'MessageSquare', 'Users', 'UserCheck', 'Handshake', 'Link2',
  // Tools / craft
  'Wrench', 'Hammer', 'Pickaxe', 'Cog', 'Settings', 'Cpu',
  // Geometry / abstract
  'Hexagon', 'Octagon', 'Triangle', 'Square', 'Circle', 'Pyramid', 'Boxes',
  'Box', 'Layers',
  // Imagery
  'Eye', 'EyeOff', 'Lock', 'Unlock', 'Key', 'Compass', 'Map', 'Mountain',
  'TreePine', 'Camera', 'Music', 'Mic',
];

// De-duplicate while preserving order — Crown appears twice intentionally
// above so the linter doesn't get angry; clean it here.
const ICON_LIST = Array.from(new Set(RECENT_LUCIDE_NAMES));

interface PinIconPickerProps {
  value: string;
  onSelect: (iconName: string) => void;
  onClose: () => void;
}

export function PinIconPicker({ value, onSelect, onClose }: PinIconPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return ICON_LIST;
    const q = search.toLowerCase();
    // Include an exact match for any lucide icon (so "BookOpen" still works
    // even though it's not in our curated list) — if the typed name resolves
    // we surface it as the first hit.
    const inList = ICON_LIST.filter(n => n.toLowerCase().includes(q));
    const exactMatch = Object.keys(LUCIDE_MAP).find(n => n.toLowerCase() === q);
    if (exactMatch && !inList.includes(exactMatch)) {
      return [exactMatch, ...inList];
    }
    return inList;
  }, [search]);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick an icon</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search lucide icons (e.g. 'Crown', 'fire'...)"
            className="pl-7 h-8 text-xs"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-8 gap-1.5 max-h-[50vh] overflow-y-auto pr-1 py-1">
          {filtered.map(name => {
            const Icon = LUCIDE_MAP[name];
            if (!Icon) return null;
            const active = value === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onSelect(name)}
                className={cn(
                  'aspect-square flex items-center justify-center rounded border transition-colors',
                  active
                    ? 'border-neon bg-neon/10'
                    : 'border-border-default bg-surface-raised/40 hover:bg-surface-overlay/40',
                )}
                title={name}
              >
                <Icon size={16} className={active ? 'text-neon' : 'text-text-secondary'} />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-[11px] text-text-muted text-center py-4">
              No icons match. Try a different search.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
