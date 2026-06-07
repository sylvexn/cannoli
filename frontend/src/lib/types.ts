import type { PokemonType } from './pokemon';

/** Authenticated user */
export interface User {
  id: string;
  username: string;
  role: 'dev' | 'admin' | 'user';
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  displayName?: string | null;
  bio?: string | null;
  avatarPath?: string | null;
  // ─── Coach flair (passive identity expressions) ──────────────────────
  /** pokemon.id of chosen signature mon — renders as a 14–16px sprite next
   *  to the coach's name in CoachLink. Null = no signature. */
  signaturePokemonId?: number | null;
  /** Short user-set string (≤ 40), shown under display_name + in popover. */
  title?: string | null;
  /** Canonical Pokemon type name — drives chip + optional avatar tint. */
  signatureType?: PokemonType | null;
}

/** League-level configuration (admin-managed) */
export interface LeagueConfig {
  /** Maximum total effective points allowed on a roster */
  pointCap: number;
  /** Number of tera captains allowed per team */
  teraCaptainSlots: number;
}

export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = {
  pointCap: 110,
  teraCaptainSlots: 2,
};

export interface CoachOwner {
  username: string;
  displayName: string | null;
  avatarPath: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  role: 'dev' | 'admin' | 'user';
  // Coach flair — surfaced on owner objects so CoachLink can render the
  // signature sprite + type chip everywhere a team owner appears.
  signaturePokemonId?: number | null;
  signaturePokemonName?: string | null;
  title?: string | null;
  signatureType?: PokemonType | null;
}

export interface Player {
  id: string;
  name: string;
  teamName: string;
  teamAbbrev: string;
  teamColor: string;
  /** Owner user id (null if no manager assigned) */
  userId?: number | null;
  /** Coach identity joined from the users table — for <CoachLink> rendering. */
  owner?: CoachOwner | null;
  /** Set after the team locks its tera captains during the post-draft gate. */
  captainsLocked?: boolean;
  /** Public path to uploaded team banner; null for color-block fallback. */
  bannerPath?: string | null;
  /** Long-form team description (≤ 280, owner-editable). */
  bio?: string | null;
  /** Short team motto (≤ 80, owner-editable). */
  motto?: string | null;
  /** Owner-authored captain note (≤ 280) shown on the team page. */
  captainNote?: string | null;
  record: { wins: number; losses: number; differential: number; kills?: number; deaths?: number };
  /** Set when this player is in a tied wins-bucket — describes which rule resolved their order. */
  tiebreaker?: { rule: 'h2h' | 'diff' | 'kills' | 'id'; value: number | string } | null;
  roster: RosterPokemon[];
}

export interface RosterPokemon {
  name: string;
  /** Owner-set nickname (≤ 40 chars, italicized in UI). Null when none set. */
  nickname?: string | null;
  /** rosters.id — needed for the PUT nickname route. */
  rosterId?: number;
  types: PokemonType[];
  /** Base tier cost (before tera captain markup) */
  tier: number;
  isTeraCaptain: boolean;
  teraTypes?: PokemonType[];
  stats: {
    hp: number; atk: number; def: number; spa: number; spd: number; spe: number;
  };
  abilities: string[];
  seasonStats: {
    kills: number; deaths: number; gp: number;
  };
  isShiny?: boolean;
}

export interface MatchPokemonEntry {
  name: string;
  kills: number;
  deaths: number;
  teraUsed: boolean;
  teraType?: PokemonType;
}

export interface Match {
  id: string;
  week: number;
  homePlayer: string;
  awayPlayer: string;
  homeScore?: number;
  awayScore?: number;
  replayUrl?: string;
  phase?: 'regular' | 'playoffs';
  playoffRound?: string | null;
  homeSeed?: number | null;
  awaySeed?: number | null;
  pokemonKD?: {
    home: MatchPokemonEntry[];
    away: MatchPokemonEntry[];
  };
}

export interface DraftPick {
  round: number;
  pick: number;
  playerId: string;
  pokemonName: string;
  tier: number;
  isTeraCaptain: boolean;
}

/**
 * Per-league season summary surfaced on the League object.
 *
 * Lifecycle fields (phase, currentWeek, totalWeeks, weekDates, paused,
 * forfeitPolicy, tradeDeadlineWeek) live on the league row in the backend —
 * Cannoli runs 3 concurrent leagues per season and they advance independently.
 * `seasonNumber` and `pointCap` / `teraCaptainSlots` remain truly season-wide.
 *
 * The shape is preserved on the wire under `season` for backwards-compat with
 * existing consumers; treat reads of these fields as "the league's value of …".
 */
export interface LeagueSeason {
  id: string;
  seasonNumber: number;
  phase: 'predraft' | 'draft' | 'regular' | 'playoffs' | 'offseason';
  currentWeek: number;
  totalWeeks: number;
  pointCap: number;
  teraCaptainSlots: number;
  tradeDeadlineWeek: number;
  forfeitPolicy?: 'double_forfeit' | 'admin_review';
  paused?: boolean;
  archived?: boolean;
  weekDates?: Record<string, string> | null;
}

export interface Trade {
  id: string;
  week: number;
  status: 'pending' | 'awaiting_admin' | 'accepted' | 'rejected' | 'expired';
  proposer: string;
  recipient: string;
  offering: string[];
  requesting: string[];
  proposedAt: string;
  resolvedAt?: string;
}

export interface TradeBlockListing {
  teamId: string;
  pokemonName: string;
  note?: string;
}

export interface League {
  id: string;
  name: string;
  color: string;
  draftDate?: string | null;
  /** Configurable bracket size for this league's playoffs (2/4/6/8). Per-league. */
  playoffTeamCount: number;
  season: LeagueSeason;
  players: Player[];
  hasData: boolean;
}

export type EventCategory = 'admin' | 'auth' | 'config' | 'draft' | 'trade' | 'fa' | 'match' | 'team' | 'scrim';

export interface ActivityEvent {
  id: string;
  type: string;
  category: EventCategory;
  actor: string;
  description: string;
  leagueId?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}
