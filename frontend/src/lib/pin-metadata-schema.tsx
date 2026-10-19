/**
 * Pin metadata rendering. Which INPUTS an award collects is declared on the
 * pin definition (`metadataFields`, edited in the admin definition dialog),
 * not hardcoded here. This module only turns a stored metadata blob into the
 * tooltip detail line — Pokemon and team names as real links, per the
 * cross-linking convention. Stat pins (champion, kingslayer, ...) get a
 * purpose-built line; everything else renders its declared pokemon/nickname.
 */
import type { ReactNode } from 'react';
import { PokemonLink } from '@/components/pokemon-link';
import { TeamLink } from '@/components/team-link';
import type { PinMetadataFieldName } from '@/lib/api';

export interface PinDefFieldsLike {
  id: string;
  metadataFields?: readonly PinMetadataFieldName[] | null;
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

/** Team ids are `<leagueId>-<abbrev>`; strip the league prefix for a readable
 *  label. Plain text when the caller doesn't know the league. */
function abbrevOf(teamId: string, leagueId: string | null | undefined): string {
  const prefix = leagueId ? `${leagueId}-` : '';
  return (prefix && teamId.startsWith(prefix) ? teamId.slice(prefix.length) : teamId).toUpperCase();
}

function team(teamId: string, leagueId: string | null | undefined): ReactNode {
  if (!leagueId) {
    return <span key={`team-${teamId}`} className="font-mono">{abbrevOf(teamId, leagueId)}</span>;
  }
  return (
    <TeamLink
      key={`team-${teamId}`}
      team={{ leagueId, teamId, teamName: abbrevOf(teamId, leagueId), teamAbbrev: abbrevOf(teamId, leagueId), teamColor: '#94a3b8' }}
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
  def: PinDefFieldsLike,
  metadata: Record<string, unknown> | null | undefined,
  leagueId?: string | null,
): ReactNode | null {
  if (!metadata) return null;
  const pinDefId = def.id;
  const fields = def.metadataFields ?? [];

  const pokemon = str(metadata, 'pokemon');
  const nickname = str(metadata, 'nickname');
  const note = str(metadata, 'note');

  switch (pinDefId) {
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

    default: {
      const nick = fields.includes('nickname') ? nickname : null;
      const tail = note ? <> · {note}</> : null;
      if (nick && pokemon) return <>&ldquo;{nick}&rdquo; — {mon(pokemon)}{tail}</>;
      if (nick) return <>&ldquo;{nick}&rdquo;{tail}</>;
      if (pokemon) return <>{mon(pokemon)}{tail}</>;
      return note;
    }
  }
}
