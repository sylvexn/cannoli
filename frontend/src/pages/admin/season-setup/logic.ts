import type { ApiCreateSeasonBody, ApiRuleset, ApiSeasonSetupDefaults } from '@/lib/api';
import { formErrors, summarize, toForm, toInput, type RulesetForm } from '../rulesets/form';

export type RulesChoice = 'copy' | 'blank' | number; // number = template id

export interface TeamRow {
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  coachName: string;
  username: string;
}

export interface SetupLeague {
  key: string;
  /** null = brand-new league */
  sourceLeagueId: string | null;
  /** ruleset id of the source league (what "copy" points at) */
  copyRulesetId: number | null;
  slug: string;
  name: string;
  color: string;
  included: boolean;
  choice: RulesChoice;
  rules: RulesetForm;
  teams: TeamRow[];
  expectedTeams: number;
  /** datetime-local value */
  draftDate: string;
}

export interface Draft {
  v: 1;
  step: number;
  maxStep: number;
  seasonNumber: number;
  totalWeeks: number;
  tradeDeadlineWeek: number;
  playoffTeamCount: number;
  forfeitPolicy: 'double_forfeit' | 'admin_review';
  format: string;
  weekDates: Record<string, string>;
  leagues: SetupLeague[];
}

export const emptyTeam = (): TeamRow => ({ teamName: '', teamAbbrev: '', teamColor: '#888888', coachName: '', username: '' });
export const teamComplete = (t: TeamRow) => !!t.teamName.trim() && !!t.teamAbbrev.trim();

export const slugify = (name: string) =>
  name.toLowerCase().replace(/\s+league$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const leagueId = (seasonNumber: number, slug: string) => `s${seasonNumber}-${slug}`;

export const blankForm = (): RulesetForm => toForm({ name: 'Blank' });

type SrcLeague = ApiSeasonSetupDefaults['leagues'][number];
const srcForm = (l: SrcLeague): RulesetForm =>
  toForm({ ...l.ruleset, id: undefined, teraMarkup: l.ruleset.teraMarkup } as never);

/** The rules a choice starts from. */
export function baseFor(l: Pick<SetupLeague, 'choice' | 'sourceLeagueId'>, d: ApiSeasonSetupDefaults, templates: ApiRuleset[]): RulesetForm {
  if (l.choice === 'copy') {
    const src = d.leagues.find(s => s.sourceLeagueId === l.sourceLeagueId);
    if (src) return srcForm(src);
  } else if (typeof l.choice === 'number') {
    const t = templates.find(x => x.id === l.choice);
    if (t) return toForm(t);
  }
  return blankForm();
}

/** What the league's rules are compared against ("vs S{prev}"). */
export const prevFor = (l: Pick<SetupLeague, 'sourceLeagueId'>, d: ApiSeasonSetupDefaults): RulesetForm | null => {
  const src = d.leagues.find(s => s.sourceLeagueId === l.sourceLeagueId);
  return src ? srcForm(src) : null;
};

export function initDraft(d: ApiSeasonSetupDefaults): Draft {
  const first = d.leagues[0];
  return {
    v: 1, step: 0, maxStep: 0,
    seasonNumber: d.nextSeasonNumber,
    totalWeeks: first?.totalWeeks ?? 11,
    tradeDeadlineWeek: first?.tradeDeadlineWeek ?? 7,
    playoffTeamCount: first?.playoffTeamCount ?? 4,
    forfeitPolicy: first?.forfeitPolicy ?? 'double_forfeit',
    format: first?.format ?? 'gen9natdex',
    weekDates: {},
    leagues: d.leagues.map(l => ({
      key: l.sourceLeagueId, sourceLeagueId: l.sourceLeagueId, copyRulesetId: l.ruleset.id,
      slug: l.slug, name: l.name, color: l.color,
      included: true, choice: 'copy', rules: srcForm(l), expectedTeams: l.teams.length, draftDate: '',
      teams: l.teams.map(t => ({ teamName: t.teamName, teamAbbrev: t.teamAbbrev, teamColor: t.teamColor, coachName: t.coachName, username: t.username ?? '' })),
    })),
  };
}

export function newLeague(name: string, color: string, templates: ApiRuleset[]): SetupLeague {
  const t = templates[0];
  return {
    key: `new-${Date.now()}`, sourceLeagueId: null, copyRulesetId: null, slug: slugify(name), name: name.trim(), color,
    included: true, choice: t ? t.id : 'blank', rules: t ? toForm(t) : blankForm(), teams: [], expectedTeams: 12, draftDate: '',
  };
}

const KEYS = ['costFormat', 'pointCap', 'rosterSize', 'rosterMin', 'rosterMax', 'megaCap', 'teraEnabled', 'teraCaptainSlots', 'teraTypesPerCaptain', 'teraMarkup'] as const;
export type RuleKey = typeof KEYS[number];

export function changedKeys(a: RulesetForm, b: RulesetForm): RuleKey[] {
  const x = toInput(a), y = toInput(b);
  return KEYS.filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
}

export const summaryOf = (f: RulesetForm) =>
  summarize({ costFormat: f.costFormat, pointCap: f.pointCap, rosterSize: f.rosterSize, teraEnabled: f.teraEnabled, teraCaptainSlots: f.teraCaptainSlots, megaCap: f.megaLimited ? f.megaCap : null });

/** Summary segments (same order as `summarize`) with a changed flag each. */
export function summarySegments(f: RulesetForm, prev: RulesetForm | null): { text: string; changed: boolean }[] {
  const ch = new Set<RuleKey>(prev ? changedKeys(f, prev) : []);
  const groups: RuleKey[][] = [['costFormat'], ['pointCap'], ['rosterSize', 'rosterMin', 'rosterMax'], ['teraEnabled', 'teraCaptainSlots', 'teraTypesPerCaptain', 'teraMarkup'], ['megaCap']];
  return summaryOf(f).split(' · ').map((text, i) => ({ text, changed: groups[i].some(k => ch.has(k)) }));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fillWeekly(week1: string, totalWeeks: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let w = 1; w <= totalWeeks; w++) out[String(w)] = addDays(week1, (w - 1) * 7);
  return out;
}

export const includedLeagues = (d: Draft) => d.leagues.filter(l => l.included);

export function buildPayload(d: Draft, overlapOverride: boolean): ApiCreateSeasonBody {
  const dates = Object.fromEntries(Object.entries(d.weekDates).filter(([w, v]) => !!v && Number(w) <= d.totalWeeks));
  return {
    seasonNumber: d.seasonNumber, totalWeeks: d.totalWeeks, tradeDeadlineWeek: Math.min(d.tradeDeadlineWeek, d.totalWeeks),
    playoffTeamCount: d.playoffTeamCount, forfeitPolicy: d.forfeitPolicy, format: d.format,
    weekDates: Object.keys(dates).length ? dates : null, overlapOverride,
    leagues: includedLeagues(d).map(l => {
      const { name: _n, description: _d, ...rules } = toInput(l.rules);
      return {
        slug: l.slug, name: l.name, color: l.color,
        draftDate: l.draftDate ? new Date(l.draftDate).toISOString() : null,
        sourceRulesetId: l.choice === 'copy' ? l.copyRulesetId : l.choice === 'blank' ? null : l.choice,
        rules: rules as ApiCreateSeasonBody['leagues'][number]['rules'],
        teams: l.teams.filter(teamComplete).map(t => ({
          teamName: t.teamName.trim(), teamAbbrev: t.teamAbbrev.trim(), teamColor: t.teamColor,
          managerUsername: t.username.trim() || null, coachName: t.coachName.trim() || undefined,
        })),
      };
    }),
  };
}

/**
 * Blocking problems: duplicate abbrev within a league, one username on two teams
 * (a coach owns one team per season), invalid rules. Checks only what `buildPayload`
 * would send (included leagues, complete teams). `step` = wizard step being left, so
 * problems on a later step never block reaching it (rules from step 1, teams from step 2).
 */
export function blockingErrors(d: Draft, step = 4): string[] {
  const out: string[] = [];
  const owners = new Map<string, string>();
  for (const l of includedLeagues(d)) {
    const abbrs = new Set<string>();
    if (step >= 1) for (const e of formErrors(l.rules)) out.push(`${l.name} rules: ${e}`);
    if (step < 2) continue;
    for (const t of l.teams.filter(teamComplete)) {
      const a = t.teamAbbrev.trim().toLowerCase();
      if (abbrs.has(a)) out.push(`${l.name}: duplicate abbreviation ${a.toUpperCase()}`);
      abbrs.add(a);
      const u = t.username.trim().toLowerCase();
      if (!u) continue;
      const prior = owners.get(u);
      if (prior) out.push(`${u} is on two teams (${prior}, ${l.name}); one team per season`);
      else owners.set(u, l.name);
    }
  }
  return [...new Set(out)];
}

/** A saved draft is only reusable if its season is still unclaimed and every league/ruleset it points at still exists. */
export function draftFits(d: Draft, defaults: ApiSeasonSetupDefaults, templates: ApiRuleset[]): boolean {
  if (d.seasonNumber < defaults.nextSeasonNumber) return false;
  return d.leagues.every(l =>
    (l.sourceLeagueId === null || defaults.leagues.some(s => s.sourceLeagueId === l.sourceLeagueId && s.ruleset.id === l.copyRulesetId))
    && (typeof l.choice !== 'number' || templates.some(t => t.id === l.choice)));
}
