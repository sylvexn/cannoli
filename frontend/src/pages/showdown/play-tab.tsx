/**
 * Play tab — full-page iframe to the private Showdown server.
 * Open sandbox: challenge anyone, ladder, practice, build teams.
 * Auto-authenticated via shared SSO cookie on .cannoli.live domain.
 *
 * Layout note: iframes don't honour flex shrink the way block elements do —
 * a `w-full h-full` iframe inside a flex column will happily render at its
 * intrinsic size and leak past the parent. We constrain it with a
 * `position: relative; overflow: hidden` wrapper and pin the iframe with
 * `position: absolute; inset: 0`, which forces it to exactly the wrapper's
 * box at any viewport size.
 */

const PS_URL = import.meta.env.VITE_SHOWDOWN_URL || 'https://sim.cannoli.live';

export function PlayTab() {
  return (
    <div
      className="relative h-full w-full rounded-lg border border-border-default"
      style={{ overflow: 'hidden', maxWidth: '100%', maxHeight: '100%' }}
    >
      <iframe
        src={PS_URL}
        className="absolute inset-0 block h-full w-full border-0"
        allow="clipboard-write"
        title="Pokemon Showdown"
      />
    </div>
  );
}
