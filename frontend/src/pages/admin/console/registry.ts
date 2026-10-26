import { Settings, Zap, CalendarClock, ScrollText, Layers, List, CalendarCog, Lock, type LucideIcon } from 'lucide-react';

export type SectionId = 'general' | 'draft' | 'deadlines' | 'league' | 'rules' | 'templates' | 'tiers' | 'rulesets';

export interface SectionDef { id: SectionId; label: string; icon: LucideIcon; from: string }

export const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: Settings, from: 'Site Settings' },
  { id: 'draft', label: 'Draft', icon: Zap, from: 'Site Settings' },
  { id: 'deadlines', label: 'Deadlines', icon: CalendarClock, from: 'Site Settings + leagues' },
  { id: 'league', label: 'League & season', icon: CalendarCog, from: 'Seasons & Leagues' },
  { id: 'rules', label: 'Rules text', icon: ScrollText, from: 'Rules tab' },
  { id: 'templates', label: 'Templates', icon: Layers, from: 'Templates tab' },
  { id: 'tiers', label: 'Tier list', icon: List, from: 'Tier List tab' },
  { id: 'rulesets', label: 'Rulesets', icon: Lock, from: 'rule bundles' },
];

/** `field` = a real form field in the console (highlight + scroll). Otherwise the hit just opens the section. */
export interface SettingDef { id: string; label: string; section: SectionId; keywords?: string; field?: boolean }

export const SETTINGS: SettingDef[] = [
  { id: 'defaultUserPassword', label: 'Default user password', section: 'general', keywords: 'reset account login', field: true },
  { id: 'draftTimerEnabled', label: 'Enable pick timer', section: 'draft', keywords: 'clock draft time', field: true },
  { id: 'draftDemoVisible', label: 'Show demo mode', section: 'draft', keywords: 'draft board practice', field: true },
  { id: 'pointCap', label: 'Point cap', section: 'league', keywords: 'budget cost' },
  { id: 'rosterSize', label: 'Roster size', section: 'league', keywords: 'min max team size' },
  { id: 'captains', label: 'Tera captain slots', section: 'league', keywords: 'tera captain count' },
  { id: 'tradeDeadline', label: 'Trade deadline (week)', section: 'deadlines', keywords: 'trades deadline cutoff league', field: true },
  { id: 'faDeadlineWeek', label: 'Free agent deadline (week)', section: 'deadlines', keywords: 'fa free agent pickup deadline cutoff', field: true },
  { id: 'faPickupsPerSeason', label: 'Free agent pickups per season', section: 'deadlines', keywords: 'fa free agent pickup limit budget', field: true },
  { id: 'playoffTeams', label: 'Playoff team count', section: 'league', keywords: 'seeds bracket' },
  { id: 'forfeit', label: 'Forfeit policy', section: 'league', keywords: 'double forfeit admin review' },
  { id: 'format', label: 'Battle format', section: 'league', keywords: 'gen9 natdex ou' },
  { id: 'schedule', label: 'Schedule dates', section: 'league', keywords: 'week start calendar' },
  { id: 'rulesAll', label: 'Draft, battle rules, clauses, bans', section: 'rules', keywords: 'clause ban ability item move tera notes' },
  { id: 'templates', label: 'League templates', section: 'templates', keywords: 'preset banlist new season' },
  { id: 'tiers', label: 'Tier list and costs', section: 'tiers', keywords: 'pokemon cost tier format lock' },
  { id: 'rulesets', label: 'Rulesets', section: 'rulesets', keywords: 'ruleset point cap tera markup mega roster' },
];

/** Every whitespace-separated term must appear in label, section label or keywords. */
export function matchSettings(query: string, list: SettingDef[] = SETTINGS): SettingDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return list.filter(s => {
    const secLabel = SECTIONS.find(x => x.id === s.section)?.label ?? '';
    const h = `${s.label} ${secLabel} ${s.keywords ?? ''}`.toLowerCase();
    return terms.every(t => h.includes(t));
  });
}
