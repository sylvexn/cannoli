import { Link } from 'react-router-dom';
import type { ApiActivityEvent, ApiTeam } from '@/lib/api';
import { CoachLink } from '@/components/coach-link';
import { TeamLink } from '@/components/team-link';
import { pokemonRoute } from '@/lib/pokemon-route';
import { asTypedMetadata, isTypedEventName } from '@/lib/activity-events';

interface EventDescriptionProps {
  event: ApiActivityEvent;
  /** Cached teams across leagues, used to resolve teamIds → abbrev/color/name. */
  teamsPerLeague?: Record<string, ApiTeam[]>;
  /** Force-strip the actor mention from any description fallback (parent
   *  already renders the actor as <CoachLink>, so we don't want it twice). */
  stripActorPrefix?: boolean;
}

/**
 * Renders the right-of-actor portion of an activity feed entry. For known
 * event types it produces structured prose with linked entities (CoachLinks
 * for opposing coaches, team chips for involved teams, Pokemon links for
 * picks/trades). Unknown event types fall back to the cleaned description
 * string the backend wrote — same as the pre-typed behaviour.
 *
 * Renders inline (no wrapper element) so callers control layout.
 */
export function EventDescription({ event, teamsPerLeague, stripActorPrefix = true }: EventDescriptionProps) {
  if (!isTypedEventName(event.type)) {
    return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
  }

  const leagueId = event.leagueId ?? undefined;
  // Coerce metadata via the typed-event helper. Falsy → fallback path.
  // Each branch narrows independently; keep them flat to avoid over-nesting.

  if (event.type === 'draft_pick') {
    const m = asTypedMetadata('draft_pick', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return (
      <>drafted <PokemonInlineLink name={m.pokemonName} /> at pick <span className="text-text-primary tabular-nums">#{m.pickNumber}</span> for <TeamRef leagueId={leagueId} teamId={m.teamId} teamsPerLeague={teamsPerLeague} /></>
    );
  }

  if (event.type === 'draft_started') {
    return <>started the draft</>;
  }

  if (event.type === 'draft_completed') {
    const m = asTypedMetadata('draft_completed', event.metadata);
    return <>completed the draft{m ? <> ({m.totalPicks} picks)</> : null}</>;
  }

  if (event.type === 'fa_pickup') {
    const m = asTypedMetadata('fa_pickup', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return (
      <>picked up <PokemonInlineLink name={m.pokemonName} />
        {m.dropPokemonName ? <>, dropped <PokemonInlineLink name={m.dropPokemonName} /></> : null}
        {' '}for <TeamRef leagueId={leagueId} teamId={m.teamId} teamsPerLeague={teamsPerLeague} />
      </>
    );
  }

  if (event.type === 'fa_release') {
    const m = asTypedMetadata('fa_release', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return <>released <PokemonInlineLink name={m.pokemonName} /> from <TeamRef leagueId={leagueId} teamId={m.teamId} teamsPerLeague={teamsPerLeague} /></>;
  }

  if (event.type === 'trade_proposed') {
    const m = asTypedMetadata('trade_proposed', event.metadata);
    // Legacy seed/test rows can omit offering/requesting/proposerId/recipientId.
    // `asTypedMetadata` is a raw cast (no runtime validation), so guard each
    // optional read here before passing into PokemonList/TeamRef.
    if (!m || !m.proposerId || !m.recipientId) {
      return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    }
    return (
      <>proposed a trade —
        {' '}<TeamRef leagueId={leagueId} teamId={m.proposerId} teamsPerLeague={teamsPerLeague} />
        {' '}sends <PokemonList names={m.offering ?? []} />
        {' '}for <PokemonList names={m.requesting ?? []} />
        {' '}from <TeamRef leagueId={leagueId} teamId={m.recipientId} teamsPerLeague={teamsPerLeague} />
      </>
    );
  }

  if (event.type === 'trade_approved' || event.type === 'trade_counterparty_accepted') {
    const m = asTypedMetadata('trade_approved', event.metadata);
    return (
      <>{event.type === 'trade_approved' ? 'approved' : 'accepted'} the trade
        {m && m.proposerId && m.recipientId ? <>
          {' '}between <TeamRef leagueId={leagueId} teamId={m.proposerId} teamsPerLeague={teamsPerLeague} />
          {' '}and <TeamRef leagueId={leagueId} teamId={m.recipientId} teamsPerLeague={teamsPerLeague} />
        </> : null}
      </>
    );
  }

  if (event.type === 'trade_rejected' || event.type === 'trade_counterparty_rejected') {
    const m = asTypedMetadata('trade_rejected', event.metadata);
    return <>rejected the trade{m?.reason ? <> — <em className="text-text-muted">{m.reason}</em></> : null}</>;
  }

  if (event.type === 'match_result') {
    const m = asTypedMetadata('match_result', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    const sweep = (m.homeScore === 6 && m.awayScore === 0) || (m.awayScore === 6 && m.homeScore === 0);
    return (
      <>recorded a <span className="text-text-primary tabular-nums">{m.homeScore}-{m.awayScore}</span>
        {sweep ? <> sweep</> : ' result'}
        {m.warningCount && m.warningCount > 0 ? <> <span className="text-loss">({m.warningCount} warning{m.warningCount === 1 ? '' : 's'})</span></> : null}
      </>
    );
  }

  if (event.type === 'pin_awarded') {
    const m = asTypedMetadata('pin_awarded', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return (
      <>earned the <em className="italic font-medium text-amber-400">{m.pinName}</em> pin
        {m.recipientUsername && m.recipientUsername !== event.actor ? <>
          {' '}— awarded to <CoachLink coach={{ username: m.recipientUsername }} size="xs" />
        </> : null}
      </>
    );
  }

  if (event.type === 'tera_captains_locked') {
    const m = asTypedMetadata('tera_captains_locked', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return (
      <>locked tera captains for <TeamRef leagueId={leagueId} teamId={m.teamId} teamsPerLeague={teamsPerLeague} /></>
    );
  }

  if (event.type === 'tera_captains_updated') {
    const m = asTypedMetadata('tera_captains_updated', event.metadata);
    if (!m) return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
    return (
      <>updated tera captains for <TeamRef leagueId={leagueId} teamId={m.teamId} teamsPerLeague={teamsPerLeague} /></>
    );
  }

  if (event.type === 'playoffs_generated') {
    const m = asTypedMetadata('playoffs_generated', event.metadata);
    return <>generated the {m?.seedCount ?? ''}-team playoff bracket</>;
  }

  // Covered the high-traffic types; the rest fall back to backend prose.
  return <DescriptionFallback event={event} stripActor={stripActorPrefix} />;
}

// ─── Inline helpers ─────────────────────────────────────────────────────

function DescriptionFallback({ event, stripActor }: { event: ApiActivityEvent; stripActor: boolean }) {
  let text = event.description;
  if (stripActor && event.actor) {
    const re = new RegExp(`^${event.actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
    text = text.replace(re, '');
  }
  return <span>{text.toLowerCase()}</span>;
}

function PokemonInlineLink({ name }: { name: string }) {
  return (
    <Link
      to={pokemonRoute(name)}
      viewTransition
      className="text-text-primary hover:text-neon hover:underline transition-colors"
    >
      {name}
    </Link>
  );
}

function PokemonList({ names }: { names: string[] | undefined }) {
  // Backend writes are typed, but legacy/seed rows may omit the array entirely;
  // treat missing the same as empty rather than crashing the whole feed.
  if (!names || names.length === 0) return <span className="text-text-muted italic">nothing</span>;
  return (
    <>
      {names.map((n, i) => (
        <span key={`${i}-${n}`}>
          {i > 0 ? <span className="text-text-muted"> + </span> : null}
          <PokemonInlineLink name={n} />
        </span>
      ))}
    </>
  );
}

function TeamRef({
  leagueId, teamId, teamsPerLeague,
}: {
  leagueId: string | undefined;
  teamId: string;
  teamsPerLeague: Record<string, ApiTeam[]> | undefined;
}) {
  const team = leagueId && teamsPerLeague?.[leagueId]?.find(t => t.id === teamId);
  if (!leagueId) {
    return <span className="font-medium text-text-secondary">{teamId}</span>;
  }
  if (!team) {
    // No cache hit — render as plain link with raw id. Still navigable.
    return (
      <Link
        to={`/league/${leagueId}/teams/${teamId}`}
        viewTransition
        className="font-medium text-text-primary hover:text-neon hover:underline transition-colors"
      >
        {teamId}
      </Link>
    );
  }
  return (
    <TeamLink
      team={{
        leagueId,
        teamId,
        teamName: team.teamName,
        teamAbbrev: team.teamAbbrev,
        teamColor: team.teamColor,
        logoPath: team.logoPath ?? null,
        record: team.record,
      }}
      logoSize="sm"
      size="xs"
    />
  );
}
