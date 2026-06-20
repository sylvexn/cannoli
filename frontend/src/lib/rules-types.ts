/**
 * Structured per-league rules document. Mirrors the backend shape in
 * `backend/src/lib/rules-defaults.ts` — keep the two in sync.
 *
 * Rendered on the public /rules page and edited in the admin Rules tab. The
 * backend resolves each league to either its saved document or the cost-format
 * default, so the frontend always receives a complete RulesContent.
 */

export interface Clause {
  name: string;
  description: string;
}

export interface PokemonBan {
  pokemon: string;
  move: string;
}

export interface RulesContent {
  /** Freeform "Additional Notes" prose (newlines preserved). */
  notes: string;
  draftRules: string[];
  battleRules: string[];
  clauses: Clause[];
  pokemonBans: PokemonBan[];
  bannedAbilities: string[];
  bannedItems: string[];
  bannedMoves: string[];
  /** Pokémon draftable but not eligible as a Tera Captain. */
  teraCaptainBans: string[];
}

/** Response shape of GET /api/leagues/:id/rules. */
export interface LeagueRulesResponse {
  leagueId: string;
  /** Resolved content — the saved override if present, else the format default. */
  content: RulesContent;
  /** Whether this league has an admin-saved override (vs. showing the default). */
  isCustom: boolean;
  updatedAt: string | null;
  /** The pristine cost-format default, for a one-click reset in the editor. */
  defaults: RulesContent;
}

/** An empty document — used as editor scaffolding before data loads. */
export function emptyRules(): RulesContent {
  return {
    notes: '',
    draftRules: [],
    battleRules: [],
    clauses: [],
    pokemonBans: [],
    bannedAbilities: [],
    bannedItems: [],
    bannedMoves: [],
    teraCaptainBans: [],
  };
}
