/**
 * Pokemon Showdown battle protocol parser for draft league replay analysis.
 *
 * Extracts per-Pokemon K/D, tera usage, and match results from battle logs.
 * Supports both full-log parsing (post-match) and incremental line-by-line
 * feeding (live Arena stats).
 *
 * Kill attribution logic ported from epl-replay-stats
 * (noah-lichtenberg/epl-replay-stats).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PokemonMatchStats {
  species: string;
  player: 'p1' | 'p2';
  kills: number;
  deaths: number; // 0 or 1
  teraUsed: boolean;
  teraType: string | null;
  brought: boolean; // appeared in the team of 6 (from |poke| lines)
  appeared: boolean; // actually entered battle (from |switch|/|drag|)
}

export interface ParsedMatchResult {
  /** Winning player's username (null if tie) */
  winner: string | null;
  /** Losing player's username (null if tie) */
  loser: string | null;
  winnerScore: number;
  loserScore: number;
  format: string | null;
  pokemon: PokemonMatchStats[];
  /** Player usernames keyed by side */
  players: { p1: string; p2: string };
}

export interface LiveMatchStats {
  home: {
    player: string;
    pokemon: {
      species: string;
      kills: number;
      fainted: boolean;
      teraUsed: boolean;
      teraType: string | null;
      brought: boolean;
    }[];
  };
  away: {
    player: string;
    pokemon: {
      species: string;
      kills: number;
      fainted: boolean;
      teraUsed: boolean;
      teraType: string | null;
      brought: boolean;
    }[];
  };
  turn: number;
  terasRemaining: { home: boolean; away: boolean };
}

export interface ValidationWarning {
  type: 'invalid_pokemon' | 'unauthorized_tera' | 'format_mismatch';
  team?: string;
  pokemon?: string;
  reason: string;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

export class ReplayParser {
  // Player info
  private players: { p1: string; p2: string } = { p1: '', p2: '' };

  // Species tracking: "p1a: Nickname" → "Species"
  private nickToSpecies = new Map<string, string>();
  // Position → player side: "p1a: Nickname" → "p1"
  private nickToSide = new Map<string, 'p1' | 'p2'>();

  // Per-Pokemon stats: keyed by "p1:Species"
  private stats = new Map<string, PokemonMatchStats>();

  // Kill attribution
  private lastAttacker = new Map<string, string>(); // target nick → attacker nick
  // Hazard source tracking: "p1" side → who set each hazard
  private hazardSetters = new Map<string, Map<string, string>>(); // side → hazard name → setter nick

  // Active Pokemon on each side
  private activeSlot = new Map<string, string>(); // "p1a" → "p1a: Nickname"

  // Match state
  private turn = 0;
  private format: string | null = null;
  private winner: string | null = null;
  private teraUsedBySide = { p1: false, p2: false };

  // Team preview roster (from |poke| lines)
  private teamPreview: { p1: string[]; p2: string[] } = { p1: [], p2: [] };

  // Lethal-hit attribution staged from |-damage| and consumed by |faint|.
  // Keyed by target nick → killer nick.
  private pendingKiller = new Map<string, string>();

  /**
   * Parse a complete battle log (post-match).
   */
  static parse(log: string): ParsedMatchResult {
    const parser = new ReplayParser();
    const lines = log.split('\n');
    for (const line of lines) {
      parser.feedLine(line);
    }
    return parser.getResult();
  }

  /**
   * Feed a single protocol line (for incremental/live parsing).
   * Returns true if the line caused a state change worth broadcasting.
   */
  feedLine(raw: string): boolean {
    const line = raw.trim();
    if (!line || line === '|') return false;

    // Strip room prefix: ">battle-gen9natdexdraft-12345\n"
    if (line.startsWith('>')) return false;

    const parts = line.split('|');
    // parts[0] is always empty string (line starts with |)
    const cmd = parts[1];
    if (!cmd) return false;

    switch (cmd) {
      case 'player': return this.handlePlayer(parts);
      case 'poke': return this.handlePoke(parts);
      case 'tier': return this.handleTier(parts);
      case 'switch':
      case 'drag': return this.handleSwitch(parts);
      case 'detailschange': return this.handleDetailsChange(parts);
      case 'move': return this.handleMove(parts);
      case '-damage': return this.handleDamage(parts);
      case 'faint': return this.handleFaint(parts);
      case '-terastallize': return this.handleTera(parts);
      case 'turn': return this.handleTurn(parts);
      case 'win': return this.handleWin(parts);
      case 'tie': return this.handleTie();
      case '-sidestart': return this.handleSideStart(parts);
      default: return false;
    }
  }

  /**
   * Get the final parsed result.
   */
  getResult(): ParsedMatchResult {
    const allStats = Array.from(this.stats.values());
    const p1Deaths = allStats.filter(s => s.player === 'p1' && s.deaths > 0).length;
    const p2Deaths = allStats.filter(s => s.player === 'p2' && s.deaths > 0).length;
    const p1Remaining = allStats.filter(s => s.player === 'p1' && s.brought).length - p1Deaths;
    const p2Remaining = allStats.filter(s => s.player === 'p2' && s.brought).length - p2Deaths;

    let winner: string | null = null;
    let loser: string | null = null;
    let winnerScore = 0;
    let loserScore = 0;

    if (this.winner) {
      if (this.winner === this.players.p1) {
        winner = this.players.p1;
        loser = this.players.p2;
        winnerScore = p1Remaining;
        loserScore = p2Remaining;
      } else {
        winner = this.players.p2;
        loser = this.players.p1;
        winnerScore = p2Remaining;
        loserScore = p1Remaining;
      }
    }

    return {
      winner,
      loser,
      winnerScore,
      loserScore,
      format: this.format,
      pokemon: allStats,
      players: { ...this.players },
    };
  }

  /**
   * Get live match stats suitable for Arena broadcast.
   *
   * The parser itself is PS-protocol-pure — it has no concept of "home" vs
   * "away" beyond the side a player happens to occupy. The caller passes
   * `homeSide` to indicate which PS side (p1/p2) the Cannoli home team is
   * playing as for THIS match. Defaults to 'p1' for back-compat with tests
   * and ad-hoc replay parsing where orientation is unknown.
   *
   * Without this, ~half of all matches end up with home/away swapped in the
   * Arena HUD (the bug being fixed): PS picks p1/p2 based on who challenged
   * whom, which has nothing to do with which side Cannoli marked home.
   */
  getLiveStats(homeSide: 'p1' | 'p2' = 'p1'): LiveMatchStats {
    const allStats = Array.from(this.stats.values());
    const awaySide = homeSide === 'p1' ? 'p2' : 'p1';

    const makeSide = (side: 'p1' | 'p2') => ({
      player: this.players[side],
      pokemon: allStats
        .filter(s => s.player === side && s.brought)
        .map(s => ({
          species: s.species,
          kills: s.kills,
          fainted: s.deaths > 0,
          teraUsed: s.teraUsed,
          teraType: s.teraType,
          brought: s.appeared,
        })),
    });

    return {
      home: makeSide(homeSide),
      away: makeSide(awaySide),
      turn: this.turn,
      terasRemaining: {
        home: !this.teraUsedBySide[homeSide],
        away: !this.teraUsedBySide[awaySide],
      },
    };
  }

  // ─── Protocol Handlers ──────────────────────────────────────────────────

  /** |player|p1|USERNAME|AVATAR| */
  private handlePlayer(parts: string[]): boolean {
    const side = parts[2] as 'p1' | 'p2';
    const name = parts[3];
    if (side === 'p1' || side === 'p2') {
      this.players[side] = name;
      this.hazardSetters.set(side, new Map());
    }
    return false;
  }

  /** |poke|p1|Species, L100, M|item — team preview */
  private handlePoke(parts: string[]): boolean {
    const side = parts[2] as 'p1' | 'p2';
    const speciesRaw = parts[3];
    const species = this.parseSpecies(speciesRaw);
    if (side === 'p1' || side === 'p2') {
      this.teamPreview[side].push(species);
      this.getOrCreateStats(side, species).brought = true;
    }
    return false;
  }

  /** |tier|[Gen 9] NatDex Draft */
  private handleTier(parts: string[]): boolean {
    this.format = parts[2] || null;
    return false;
  }

  /** |switch|p1a: Nickname|Species, Gender|HP/MAXHP */
  private handleSwitch(parts: string[]): boolean {
    const nick = parts[2]; // "p1a: Nickname"
    const speciesRaw = parts[3];
    const species = this.parseSpecies(speciesRaw);
    const side = this.parseSide(nick);

    this.nickToSpecies.set(nick, species);
    this.nickToSide.set(nick, side);

    // Update active slot
    const slot = nick.substring(0, 3); // "p1a" or "p2a"
    this.activeSlot.set(slot, nick);

    const stats = this.getOrCreateStats(side, species);
    stats.appeared = true;
    // Also mark as brought in case |poke| lines were missing
    stats.brought = true;

    return true;
  }

  /** |detailschange|p1a: Nickname|Species-Mega, Gender — mega evolution, form change */
  private handleDetailsChange(parts: string[]): boolean {
    const nick = parts[2];
    const speciesRaw = parts[3];
    const newSpecies = this.parseSpecies(speciesRaw);
    const oldSpecies = this.nickToSpecies.get(nick);

    if (oldSpecies && oldSpecies !== newSpecies) {
      // Transfer stats from old species to new (mega evolution)
      const side = this.nickToSide.get(nick)!;
      const oldKey = `${side}:${oldSpecies}`;
      const existing = this.stats.get(oldKey);
      if (existing) {
        // Re-key the stats entry under the new species
        this.stats.delete(oldKey);
        existing.species = newSpecies;
        this.stats.set(`${side}:${newSpecies}`, existing);
      }
    }

    this.nickToSpecies.set(nick, newSpecies);
    return false;
  }

  /** |move|p1a: Nick|Move Name|p2a: Target */
  private handleMove(parts: string[]): boolean {
    const attacker = parts[2];
    const target = parts[4];

    // Track last attacker for direct KO attribution
    if (target && !target.startsWith('[')) {
      this.lastAttacker.set(target, attacker);
    }

    return false;
  }

  /**
   * |-damage|p2a: Nick|HP/MAXHP or |-damage|p2a: Nick|0 fnt
   * Optional: |[from] source|[of] p1a: Nick
   */
  private handleDamage(parts: string[]): boolean {
    const target = parts[2];
    const hpStr = parts[3];

    if (!hpStr || !hpStr.includes('fnt')) return false;

    // This is a lethal hit — attribute the kill
    // The actual faint is confirmed by |faint|, but we figure out
    // the killer here because we have the [from]/[of] context
    const fromTag = this.findTag(parts, 'from');
    const ofTag = this.findTag(parts, 'of');

    let killerNick: string | null = null;

    if (fromTag) {
      // Indirect damage source
      if (ofTag) {
        // Specific Pokemon caused it (Rocky Helmet, Rough Skin, etc.)
        killerNick = ofTag;
      } else if (
        fromTag.startsWith('item:')
        || fromTag.startsWith('ability:')
        || fromTag === 'Recoil'
        || fromTag === 'confusion'
      ) {
        // Self-damage from own item/ability/recoil/confusion — no kill
        // credit. Without this branch, the catch-all below would credit
        // `lastAttacker(target)` — i.e. whoever last attacked the recoiler,
        // which can be the now-fainted opponent and produces a posthumous
        // bogus kill.
        killerNick = null;
      } else if (this.isHazard(fromTag)) {
        // Hazard damage — credit whoever set the hazard
        killerNick = this.getHazardSetter(target, fromTag);
      } else if (fromTag === 'psn' || fromTag === 'tox' || fromTag === 'brn') {
        // Status damage — credit whoever last attacked
        killerNick = this.lastAttacker.get(target) ?? null;
      } else if (fromTag.startsWith('move:')) {
        // Residual move damage (e.g., Leech Seed)
        if (ofTag) {
          killerNick = ofTag;
        } else {
          killerNick = this.lastAttacker.get(target) ?? null;
        }
      } else {
        // Other indirect — weather, etc. Credit last attacker
        killerNick = this.lastAttacker.get(target) ?? null;
      }
    } else {
      // Direct damage — credit last attacker
      killerNick = this.lastAttacker.get(target) ?? null;
    }

    // Store the killer decision on the target for when |faint| fires.
    // We always set the entry (even when null) so handleFaint can tell
    // "lethal-hit decision was 'no credit'" from "no lethal hit observed,
    // fall back to lastAttacker". Without the explicit null marker, a
    // recoil/confusion self-faint after a prior exchange would fall back
    // to the (now-fainted) opponent.
    this.pendingKiller.set(target, killerNick);

    return false;
  }

  /** |faint|p2a: Nickname — confirms death, apply kill credit */
  private handleFaint(parts: string[]): boolean {
    const faintedNick = parts[2];
    const side = this.nickToSide.get(faintedNick);
    const species = this.nickToSpecies.get(faintedNick);
    if (!side || !species) return true;

    // Record the death
    const faintedStats = this.getOrCreateStats(side, species);
    faintedStats.deaths = 1;

    // Apply kill credit. If handleDamage explicitly recorded a decision
    // (including "null = no credit") use that; otherwise fall back to
    // lastAttacker (covers faint-without-prior-damage-line scenarios).
    const killerNick = this.pendingKiller.has(faintedNick)
      ? this.pendingKiller.get(faintedNick) ?? null
      : this.lastAttacker.get(faintedNick) ?? null;

    if (killerNick) {
      const killerSide = this.nickToSide.get(killerNick);
      const killerSpecies = this.nickToSpecies.get(killerNick);
      if (killerSide && killerSpecies && killerSide !== side) {
        const killerStats = this.getOrCreateStats(killerSide, killerSpecies);
        killerStats.kills += 1;
      }
    }

    // Clean up pending killer
    this.pendingKiller.delete(faintedNick);

    return true;
  }

  /** |-terastallize|p1a: Nick|FireType */
  private handleTera(parts: string[]): boolean {
    const nick = parts[2];
    const teraType = parts[3];
    const side = this.nickToSide.get(nick);
    const species = this.nickToSpecies.get(nick);
    if (!side || !species) return true;

    const stats = this.getOrCreateStats(side, species);
    stats.teraUsed = true;
    stats.teraType = teraType;
    this.teraUsedBySide[side] = true;

    return true;
  }

  /** |turn|N */
  private handleTurn(parts: string[]): boolean {
    this.turn = parseInt(parts[2], 10) || 0;
    return true;
  }

  /** |win|Username */
  private handleWin(parts: string[]): boolean {
    this.winner = parts[2];
    return true;
  }

  /** |tie */
  private handleTie(): boolean {
    this.winner = null;
    return true;
  }

  /** |-sidestart|p1: Username|Stealth Rock (hazard tracking) */
  private handleSideStart(parts: string[]): boolean {
    const sideRef = parts[2]; // "p1: Username" or "p2: Username"
    const condition = parts[3];
    if (!sideRef || !condition) return false;

    // Determine which side the hazard is SET ON
    const targetSide = sideRef.startsWith('p1') ? 'p1' : 'p2';

    // The hazard was set by the OTHER side's active Pokemon
    const setterSide = targetSide === 'p1' ? 'p2' : 'p1';
    const setterSlot = `${setterSide}a`;
    const setterNick = this.activeSlot.get(setterSlot);

    if (setterNick) {
      const hazardName = condition.replace('move: ', '');
      const sideHazards = this.hazardSetters.get(targetSide);
      if (sideHazards) {
        sideHazards.set(hazardName, setterNick);
      }
    }

    return false;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Parse species from "Species, L100, M" or "Species-Mega, F" or "Species, F, tera:Fire" */
  private parseSpecies(raw: string): string {
    if (!raw) return 'Unknown';
    // Take everything before the first comma
    const species = raw.split(',')[0].trim();
    // Strip tera indicator suffix (e.g. "tera:Fighting" doesn't appear in species)
    return species;
  }

  /** Extract player side from nick: "p1a: Nickname" → "p1" */
  private parseSide(nick: string): 'p1' | 'p2' {
    return nick.startsWith('p1') ? 'p1' : 'p2';
  }

  /** Find [tag] value in parts array: "[from] Stealth Rock" → "Stealth Rock" */
  private findTag(parts: string[], tag: string): string | null {
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed.startsWith(`[${tag}] `)) {
        return trimmed.slice(tag.length + 3);
      }
      if (trimmed === `[${tag}]`) {
        return '';
      }
    }
    return null;
  }

  /** Check if a [from] source is a hazard */
  private isHazard(source: string): boolean {
    const hazards = [
      'Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web',
      'move: Stealth Rock', 'move: Spikes', 'move: Toxic Spikes',
    ];
    return hazards.includes(source);
  }

  /** Get the nick of whoever set a hazard on the fainted Pokemon's side */
  private getHazardSetter(faintedNick: string, hazardSource: string): string | null {
    const side = this.parseSide(faintedNick);
    const sideHazards = this.hazardSetters.get(side);
    if (!sideHazards) return null;

    // Normalize hazard name
    const hazardName = hazardSource.replace('move: ', '');
    return sideHazards.get(hazardName) ?? null;
  }

  /** Get or create stats for a Pokemon */
  private getOrCreateStats(side: 'p1' | 'p2', species: string): PokemonMatchStats {
    const key = `${side}:${species}`;
    let stats = this.stats.get(key);
    if (!stats) {
      stats = {
        species,
        player: side,
        kills: 0,
        deaths: 0,
        teraUsed: false,
        teraType: null,
        brought: false,
        appeared: false,
      };
      this.stats.set(key, stats);
    }
    return stats;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a parsed match result against team rosters and tera captain rules.
 */
export function validateMatchResult(
  result: ParsedMatchResult,
  homeRoster: { pokemonName: string; isTeraCaptain: boolean }[],
  awayRoster: { pokemonName: string; isTeraCaptain: boolean }[],
  homeTeamAbbrev: string,
  awayTeamAbbrev: string,
  homeSide: 'p1' | 'p2' = 'p1',
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Caller passes `homeSide` to identify which PS side the Cannoli home team
  // played as. Defaults to 'p1' for back-compat — but the bot path now
  // resolves orientation from useridToTeam so warnings hit the correct team.
  const awaySide = homeSide === 'p1' ? 'p2' : 'p1';
  const sides: Array<{
    side: 'p1' | 'p2';
    roster: typeof homeRoster;
    abbrev: string;
  }> = [
    { side: homeSide, roster: homeRoster, abbrev: homeTeamAbbrev },
    { side: awaySide, roster: awayRoster, abbrev: awayTeamAbbrev },
  ];

  for (const { side, roster, abbrev } of sides) {
    const rosterNames = new Set(roster.map(r => r.pokemonName.toLowerCase()));
    const captainNames = new Set(
      roster.filter(r => r.isTeraCaptain).map(r => r.pokemonName.toLowerCase()),
    );

    const sidePokemon = result.pokemon.filter(p => p.player === side && p.appeared);

    // Check: every Pokemon that appeared must be on the roster
    for (const mon of sidePokemon) {
      if (!rosterNames.has(mon.species.toLowerCase())) {
        warnings.push({
          type: 'invalid_pokemon',
          team: abbrev,
          pokemon: mon.species,
          reason: 'Not on roster',
        });
      }

      // Check: if terastallized, must be a tera captain
      if (mon.teraUsed && !captainNames.has(mon.species.toLowerCase())) {
        warnings.push({
          type: 'unauthorized_tera',
          team: abbrev,
          pokemon: mon.species,
          reason: 'Not a tera captain',
        });
      }
    }
  }

  // Check format
  if (result.format && !result.format.includes('NatDex Draft')) {
    warnings.push({
      type: 'format_mismatch',
      reason: `Expected [Gen 9] NatDex Draft, got ${result.format}`,
    });
  }

  return warnings;
}
