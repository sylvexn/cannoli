/**
 * Typed metadata shapes for activity-log events.
 *
 * The backend writes structured `metadata` JSON per event type (see
 * `backend/src/routes/*.ts` and `backend/src/lib/*.ts` `db.insert(activityLog)`
 * call sites). This file mirrors those shapes on the frontend so the
 * activity feed can render entity-linked descriptions instead of opaque
 * strings.
 *
 * Coverage focus: the public-feed event types only (`draft|trade|match|team|fa`
 * categories). Admin/auth/scrim events are filtered out of the public feed
 * and continue to render via `event.description` fallback.
 *
 * If a writer changes its metadata shape, update the matching interface here.
 * The frontend renderer narrows by `event.type` with a typecheck cast — there's
 * no runtime validation, so a backend/frontend drift will silently fall back
 * to the description string. Acceptable: legacy rows already work that way.
 */

// ─── Per-event metadata shapes ─────────────────────────────────────────────

export interface DraftPickMetadata {
  pickNumber: number;
  teamId: string;
  pokemonName: string;
  tier: number;
}

export interface DraftStartedMetadata {
  teamOrder: string[];
  timerDuration?: number;
}

export interface DraftCompletedMetadata {
  totalPicks: number;
}

export interface DraftPickSkippedMetadata {
  teamId: string;
  pickIndex: number;
}

export interface TradeProposedMetadata {
  tradeId: number;
  proposerId: string;
  recipientId: string;
  offering: string[];
  requesting: string[];
}

export interface TradeApprovedMetadata {
  tradeId: number;
  proposerId: string;
  recipientId: string;
}

export interface TradeRejectedMetadata {
  tradeId: number;
  reason?: string;
}

export interface TradeCounterpartyDecidedMetadata {
  tradeId: number;
  proposerId?: string;
  recipientId?: string;
  reason?: string;
}

export interface MatchResultMetadata {
  matchId: string;
  homeScore: number;
  awayScore: number;
  warningCount?: number;
}

export interface MatchVoidedMetadata {
  matchId: string;
  previousStatus: string;
  previousHomeScore?: number | null;
  previousAwayScore?: number | null;
}

export interface MatchRescheduledMetadata {
  matchId: string;
  oldWeek: number;
  newWeek: number;
  oldDeadline?: string | null;
  newDeadline?: string | null;
}

export interface FaPickupMetadata {
  teamId: string;
  pokemonName: string;
  dropPokemonName?: string | null;
}

export interface FaReleaseMetadata {
  teamId: string;
  pokemonName: string;
}

export interface PinAwardedMetadata {
  pinId: number;
  pinDefId: string;
  pinName: string;
  recipientUsername: string;
  seasonId?: number | null;
}

export interface PlayoffsGeneratedMetadata {
  seedCount: number;
  seedings: Array<{ seed: number; teamId: string }>;
}

export interface TeraCaptainsUpdatedMetadata {
  teamId: string;
  captains: string[];
}

// ─── Discriminator ─────────────────────────────────────────────────────────

/** Map event type → metadata shape for typed narrowing. */
export interface EventMetadataMap {
  draft_pick: DraftPickMetadata;
  draft_started: DraftStartedMetadata;
  draft_completed: DraftCompletedMetadata;
  draft_pick_skipped: DraftPickSkippedMetadata;
  trade_proposed: TradeProposedMetadata;
  trade_approved: TradeApprovedMetadata;
  trade_rejected: TradeRejectedMetadata;
  trade_counterparty_accepted: TradeCounterpartyDecidedMetadata;
  trade_counterparty_rejected: TradeCounterpartyDecidedMetadata;
  match_result: MatchResultMetadata;
  match_voided: MatchVoidedMetadata;
  match_rescheduled: MatchRescheduledMetadata;
  fa_pickup: FaPickupMetadata;
  fa_release: FaReleaseMetadata;
  pin_awarded: PinAwardedMetadata;
  playoffs_generated: PlayoffsGeneratedMetadata;
  tera_captains_updated: TeraCaptainsUpdatedMetadata;
  tera_captains_locked: TeraCaptainsUpdatedMetadata;
}

export type TypedEventName = keyof EventMetadataMap;

/**
 * Narrow a generic activity event payload to a typed metadata shape, or null
 * when the event type isn't covered by `EventMetadataMap`. Use this instead
 * of casting raw — keeps the renderer's switch statement honest.
 */
export function asTypedMetadata<K extends TypedEventName>(
  _type: K,
  metadata: unknown,
): EventMetadataMap[K] | null {
  if (!metadata || typeof metadata !== 'object') return null;
  // No runtime schema validation — trust the backend writers. Drift falls back
  // to the description-string render.
  return metadata as EventMetadataMap[K];
}

export function isTypedEventName(type: string): type is TypedEventName {
  return type in TYPED_EVENT_NAME_SET;
}

const TYPED_EVENT_NAME_SET: Record<TypedEventName, true> = {
  draft_pick: true,
  draft_started: true,
  draft_completed: true,
  draft_pick_skipped: true,
  trade_proposed: true,
  trade_approved: true,
  trade_rejected: true,
  trade_counterparty_accepted: true,
  trade_counterparty_rejected: true,
  match_result: true,
  match_voided: true,
  match_rescheduled: true,
  fa_pickup: true,
  fa_release: true,
  pin_awarded: true,
  playoffs_generated: true,
  tera_captains_updated: true,
  tera_captains_locked: true,
};
