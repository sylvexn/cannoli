import { Sun, CloudRain, Wind, Snowflake, CloudOff, RotateCcw, ZapOff, Wand2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import type { CalcAssumptions, Weather } from './speed-calc';

export interface SpeedFilters {
  search: string;
  teamId: string;
  trickRoom: boolean;
}

const WEATHER_BUTTONS: { value: Weather; label: string; Icon: typeof Sun; tint: string }[] = [
  { value: 'none', label: 'None', Icon: CloudOff, tint: 'text-text-muted' },
  { value: 'sun', label: 'Sun', Icon: Sun, tint: 'text-orange-400' },
  { value: 'rain', label: 'Rain', Icon: CloudRain, tint: 'text-blue-400' },
  { value: 'sand', label: 'Sand', Icon: Wind, tint: 'text-amber-500' },
  { value: 'snow', label: 'Snow', Icon: Snowflake, tint: 'text-cyan-300' },
];

interface SpeedFilterBarProps {
  filters: SpeedFilters;
  onFiltersChange: (next: Partial<SpeedFilters>) => void;
  assumptions: CalcAssumptions;
  onAssumptionsChange: (next: Partial<CalcAssumptions>) => void;
  teams: { id: string; teamAbbrev: string; teamName: string; teamColor: string }[];
  totalCount: number;
  filteredCount: number;
  onReset: () => void;
}

export function SpeedFilterBar({
  filters,
  onFiltersChange,
  assumptions,
  onAssumptionsChange,
  teams,
  totalCount,
  filteredCount,
  onReset,
}: SpeedFilterBarProps) {
  return (
    <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-border-subtle py-2 -mx-3 px-3 space-y-2">
      {/* Row 1: search, team, count, reset */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={filters.search}
            onChange={e => onFiltersChange({ search: e.target.value })}
            placeholder="Search Pokemon, team, or coach..."
            className="w-full pl-7 pr-7 py-1 rounded bg-surface text-xs border border-border-subtle focus:border-neon/40 focus:outline-none"
          />
          {filters.search && (
            <button
              onClick={() => onFiltersChange({ search: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <Select value={filters.teamId || 'all'} onValueChange={v => onFiltersChange({ teamId: v === 'all' ? '' : v ?? undefined })}>
          <SelectTrigger
            className="h-7 w-[140px] text-xs bg-surface border-border-subtle"
            title="Limit table to one team's mons. Use the league chips above to highlight without hiding."
          >
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All teams</SelectItem>
            {teams.map(t => (
              <SelectItem key={t.id} value={t.id} className="text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.teamColor }} />
                  {t.teamAbbrev} — {t.teamName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Trick Room */}
        <button
          onClick={() => onFiltersChange({ trickRoom: !filters.trickRoom })}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono uppercase tracking-wide border transition-colors',
            filters.trickRoom
              ? 'bg-pink/20 text-pink border-pink/40'
              : 'bg-surface text-text-muted border-border-subtle hover:text-text-secondary hover:border-border-default',
          )}
          title="Trick Room — invert the table sort (slowest first)"
        >
          <RotateCcw size={11} />
          Trick Room
        </button>

        <span className="text-[10px] text-text-muted font-mono ml-auto tabular-nums">
          {filteredCount} / {totalCount}
        </span>

        <button
          onClick={onReset}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary border border-border-subtle hover:border-border-default transition-colors"
          title="Reset filters and assumptions"
        >
          <ZapOff size={10} />
          Reset
        </button>
      </div>

      {/* Row 2: weather + assumptions */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Weather pills */}
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-surface-overlay/60 border border-border-subtle">
          {WEATHER_BUTTONS.map(({ value, label, Icon, tint }) => {
            const active = assumptions.weather === value;
            return (
              <button
                key={value}
                onClick={() => onAssumptionsChange({ weather: value })}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase transition-colors',
                  active ? 'bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary',
                )}
                title={`Weather: ${label}`}
              >
                <Icon size={10} className={active ? tint : ''} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Item presets */}
        <Select value={assumptions.item} onValueChange={v => onAssumptionsChange({ item: v as CalcAssumptions['item'] })}>
          <SelectTrigger className="h-7 w-[130px] text-xs bg-surface border-border-subtle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">No item (1.0x)</SelectItem>
            <SelectItem value="scarf" className="text-xs">Choice Scarf (1.5x)</SelectItem>
            <SelectItem value="iron-ball" className="text-xs">Iron Ball (0.5x)</SelectItem>
          </SelectContent>
        </Select>

        {/* Nature presets */}
        <Select value={assumptions.nature} onValueChange={v => onAssumptionsChange({ nature: v as CalcAssumptions['nature'] })}>
          <SelectTrigger className="h-7 w-[130px] text-xs bg-surface border-border-subtle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="neutral" className="text-xs">Neutral (1.0x)</SelectItem>
            <SelectItem value="plus" className="text-xs">+Speed (1.1x)</SelectItem>
            <SelectItem value="minus" className="text-xs">-Speed (0.9x)</SelectItem>
          </SelectContent>
        </Select>

        {/* Level toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-surface-overlay/60 border border-border-subtle">
          {[50, 100].map(lv => (
            <button
              key={lv}
              onClick={() => onAssumptionsChange({ level: lv })}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-mono tabular-nums uppercase transition-colors',
                assumptions.level === lv ? 'bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
              title={`Level ${lv}`}
            >
              Lv {lv}
            </button>
          ))}
        </div>

        {/* Ability toggles */}
        <ToggleChip
          label="Weather ability"
          active={assumptions.applyWeatherAbility}
          onClick={() => onAssumptionsChange({ applyWeatherAbility: !assumptions.applyWeatherAbility })}
          title="Apply Chlorophyll/Swift Swim/Sand Rush/Slush Rush when the weather matches"
        />
        <ToggleChip
          label="Unburden"
          active={assumptions.unburden}
          onClick={() => onAssumptionsChange({ unburden: !assumptions.unburden })}
          title="Treat Unburden mons as having consumed their item (2x speed)"
        />
        <ToggleChip
          label="Quick Feet"
          active={assumptions.quickFeet}
          onClick={() => onAssumptionsChange({ quickFeet: !assumptions.quickFeet })}
          title="Treat Quick Feet mons as statused (1.5x speed)"
        />
      </div>

      {/* Row 3: quick "what-if" presets */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-text-muted">Presets</span>
        <PresetButton
          label="All Scarf"
          icon={<Wand2 size={10} />}
          onClick={() => onAssumptionsChange({ item: 'scarf' })}
        />
        <PresetButton
          label="All +Speed"
          icon={<Wand2 size={10} />}
          onClick={() => onAssumptionsChange({ nature: 'plus' })}
        />
        <PresetButton
          label="Sun + Chlorophyll"
          icon={<Sun size={10} className="text-orange-400" />}
          onClick={() => onAssumptionsChange({ weather: 'sun', applyWeatherAbility: true })}
        />
        <PresetButton
          label="Rain + Swift Swim"
          icon={<CloudRain size={10} className="text-blue-400" />}
          onClick={() => onAssumptionsChange({ weather: 'rain', applyWeatherAbility: true })}
        />
        <div className="ml-auto flex items-center gap-1 text-[10px] text-text-muted">
          <span>EV/IV</span>
          <NumberInput
            value={252}
            onChange={() => {}}
            min={252}
            max={252}
            className="w-16"
            disabled
          />
          <span className="text-[9px]">/31 (max)</span>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wide border transition-colors',
        active
          ? 'bg-neon/15 text-neon border-neon/40'
          : 'bg-surface text-text-muted border-border-subtle hover:text-text-secondary hover:border-border-default',
      )}
    >
      {label}
    </button>
  );
}

function PresetButton({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-text-secondary border border-border-subtle hover:bg-surface-overlay/40 hover:text-text-primary hover:border-border-default transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}
