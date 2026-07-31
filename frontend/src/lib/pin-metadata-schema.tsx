/**
 * Per-pin metadata field schema. The minter (`mintManualPins` in
 * backend/src/lib/pins/awards-data.ts), the auto-award job
 * (`backend/src/lib/pins/auto-award.ts` + `archive-mint.ts`), and the admin
 * award flow all stash a small JSON blob on each pin (pokemon, nickname,
 * teamId, kills, etc.); this map tells the UI which of those fields exist
 * for a given pin definition, and `formatPinMetadata` renders them into the
 * tooltip detail line — Pokemon and team names as real links, per the
 * cross-linking convention.
 *
 * Keep in sync with the resolver branches in `mintManualPins` / `auto-award.ts`
 * / `archive-mint.ts` — adding a new pin that carries metadata means listing
 * its fields here and adding a render branch in `formatPinMetadata`.
 */
import type { ReactNode } from 'react';
import { PokemonLink } from '@/components/pokemon-link';
import { TeamLink } from '@/components/team-link';

export type PinMetadataField =
  | 'pokemon' | 'nickname' | 'leagueId' | 'teamId'
  | 'kills' | 'week' | 'cost' | 'ratio' | 'sweeps'
  | 'seriesScore' | 'runnerUpTeamId' | 'loserTeamId' | 'winnerRank' | 'loserRank'
  | 'scoreLine';

export const PIN_METADATA_SCHEMA: Record<string, readonly PinMetadataField[]> = {
  // Best Nickname — needs both the mon and the nickname text.
  rotom: ['pokemon', 'nickname'],

  // Mon-headlined awards — recipient is the team owner, so the mon is the
  // headline detail to render.
  dragapult: ['pokemon'],
  florges: ['pokemon'],
  charizard: ['pokemon'],
  pikachu: ['pokemon'],

  // Coach-headlined per-league awards — the league is the only metadata
  // worth surfacing (recipient is the user).
  cannoli: ['leagueId'],
  cynthia: ['leagueId'],
  'best-draft': ['leagueId'],

  // Auto-computed stat pins (season-end job + archive mint). Not manually
  // awardable, but the engine already computes rich metadata for them —
  // registering the fields here is what makes the tooltip detail line show.
  garchomp: ['pokemon', 'kills', 'teamId'],
  'high-score': ['pokemon', 'kills', 'week', 'teamId'],
  'steal-of-the-draft': ['pokemon', 'kills', 'cost', 'ratio', 'teamId'],
  sweeper: ['sweeps', 'teamId'],
  champion: ['teamId', 'runnerUpTeamId', 'seriesScore'],
  kingslayer: ['teamId', 'loserTeamId', 'winnerRank', 'loserRank'],
  flawless: ['teamId', 'scoreLine'],
};

/** Resolve schema for a pin id; falls back to no fields. */
export function pinMetadataFields(pinDefId: string): readonly PinMetadataField[] {
  return PIN_METADATA_SCHEMA[pinDefId] ?? [];
}

function str(metadata: Record<string, unknown>, key: string): string | null {
  return typeof metadata[key] === 'string' ? (metadata[key] as string) : null;
}

function num(metadata: Record<string, unknown>, key: string): number | null {
  return typeof metadata[key] === 'number' ? (metadata[key] as number) : null;
}

/** Plain (no hover-card) Pokemon link — avoids nesting a popover inside the
 *  Pin's own popover, matching the restraint TeamLink/CoachLink already use
 *  for their own nested mentions. */
function mon(name: string): ReactNode {
  return (
    <PokemonLink key={`mon-${name}`} name={name} noHoverCard className="hover:underline">
      {name}
    </PokemonLink>
  );
}

/** Plain team-abbrev link. `teams.id` IS the lowercase abbrev, so no extra
 *  lookup/fetch is needed to render a readable label. Falls back to plain
 *  text when the caller doesn't know the league (older call sites that
 *  haven't threaded `leagueId` through yet). */
function team(teamId: string, leagueId: string | null | undefined): ReactNode {
  if (!leagueId) {
    return <span key={`team-${teamId}`} className="font-mono">{teamId.toUpperCase()}</span>;
  }
  return (
    <TeamLink
      key={`team-${teamId}`}
      team={{ leagueId, teamId, teamName: teamId, teamAbbrev: teamId.toUpperCase(), teamColor: '#94a3b8' }}
      noHoverCard
      showLogo={false}
      size="xs"
    />
  );
}

/**
 * Render a metadata blob into a compact tooltip detail line per pin schema.
 * Returns `null` when there's nothing meaningful to show (pin has no schema,
 * or the metadata blob is missing the required fields).
 *
 * `leagueId` is the pin row's own league scope (not metadata — most
 * team-headlined awards only carry `teamId`) and is required to build
 * clickable team links; without it, team references render as plain text.
 */
export function formatPinMetadata(
  pinDefId: string,
  metadata: Record<string, unknown> | null | undefined,
  leagueId?: string | null,
): ReactNode | null {
  if (!metadata) return null;
  const fields = pinMetadataFields(pinDefId);
  if (fields.length === 0) return null;

  const pokemon = str(metadata, 'pokemon');
  const nickname = str(metadata, 'nickname');

  switch (pinDefId) {
    case 'rotom': {
      if (nickname && pokemon) return <>&ldquo;{nickname}&rdquo; — {mon(pokemon)}</>;
      if (nickname) return `“${nickname}”`;
      if (pokemon) return mon(pokemon);
      return null;
    }

    case 'garchomp': {
      if (!pokemon) return null;
      const kills = num(metadata, 'kills');
      return <>{mon(pokemon)}{kills != null && ` — ${kills} KO${kills === 1 ? '' : 's'}`}</>;
    }

    case 'high-score': {
      if (!pokemon) return null;
      const kills = num(metadata, 'kills');
      const week = num(metadata, 'week');
      return (
        <>
          {mon(pokemon)}
          {kills != null && ` — ${kills} KO${kills === 1 ? '' : 's'}`}
          {week != null && ` (Week ${week})`}
        </>
      );
    }

    case 'steal-of-the-draft': {
      if (!pokemon) return null;
      const kills = num(metadata, 'kills');
      const cost = num(metadata, 'cost');
      const ratio = num(metadata, 'ratio');
      return (
        <>
          {mon(pokemon)}
          {kills != null && cost != null && ` — ${kills} KOs @ ${cost}pt`}
          {ratio != null && ` (${ratio.toFixed(2)} K/pt)`}
        </>
      );
    }

    case 'sweeper': {
      const sweeps = num(metadata, 'sweeps');
      return sweeps != null ? `${sweeps} sweep${sweeps === 1 ? '' : 's'} this season` : null;
    }

    case 'champion': {
      const seriesScore = str(metadata, 'seriesScore');
      const runnerUp = str(metadata, 'runnerUpTeamId');
      if (!seriesScore && !runnerUp) return null;
      return (
        <>
          {seriesScore && `Won ${seriesScore}`}
          {runnerUp && <> vs {team(runnerUp, leagueId)}</>}
        </>
      );
    }

    case 'kingslayer': {
      const winnerRank = num(metadata, 'winnerRank');
      const loserRank = num(metadata, 'loserRank');
      const loserTeamId = str(metadata, 'loserTeamId');
      if (winnerRank == null || loserRank == null) return null;
      return (
        <>
          Upset — #{winnerRank} seed beat #{loserRank}
          {loserTeamId && <> ({team(loserTeamId, leagueId)})</>}
        </>
      );
    }

    case 'flawless': {
      const scoreLine = str(metadata, 'scoreLine');
      return scoreLine ? `Flawless — won ${scoreLine}` : null;
    }

    default:
      if (fields.includes('pokemon') && pokemon) return mon(pokemon);
      return null;
  }
}
