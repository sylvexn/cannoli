/**
 * Play tab — full-page iframe to the private Showdown server.
 * Open sandbox: challenge anyone, ladder, practice, build teams.
 * Auto-authenticated via shared SSO cookie on .cannoli.live domain.
 */

const PS_URL = import.meta.env.VITE_SHOWDOWN_URL || 'https://sim.cannoli.live';

export function PlayTab() {
  return (
    <div className="relative h-full rounded-lg overflow-hidden border border-border-default">
      <iframe
        src={PS_URL}
        className="w-full h-full"
        allow="clipboard-write"
        title="Pokemon Showdown"
      />
    </div>
  );
}
