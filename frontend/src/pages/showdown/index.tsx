/**
 * Showdown page — full-page PS iframe with a collapsible Arena footer.
 *
 * Layout:
 *   ┌───────────────────────────────┐
 *   │ PS iframe (flex-1, max space) │
 *   ├───────────────────────────────┤
 *   │ Arena footer (collapsible)    │
 *   └───────────────────────────────┘
 *
 * Iframe-shrink fix: iframes don't honour flex shrink the way block elements
 * do. We constrain the iframe with a `position: relative; overflow: hidden`
 * wrapper and pin it with `position: absolute; inset: 0`. Do NOT remove —
 * removing this causes the PS toolbar/canvas to leak past the right edge.
 */
import { ArenaFooter } from './arena-footer';

const PS_URL = import.meta.env.VITE_SHOWDOWN_URL || 'https://sim.cannoli.live';

export function ShowdownPage() {
  return (
    <div className="relative flex flex-col h-full rounded-lg border border-border-default overflow-hidden">
      {/* PS iframe — flex-1 so it gets all leftover space above the footer.
          Border + rounding live on the outer wrapper now so the footer pill
          bar visually anchors flush to the iframe edge (no gap from a
          double-bordered child).

          When the footer is in collapsed mode the pill bar is absolute-
          positioned and overlays the iframe's bottom edge (see ArenaFooter)
          — the PS client's internal grey bottom margin lives there, so we
          occlude that strip rather than letting it push the pill bar far
          below the visible canvas content. */}
      <div
        className="flex-1 min-h-0 relative"
        style={{ overflow: 'hidden', maxWidth: '100%', maxHeight: '100%' }}
      >
        <iframe
          src={PS_URL}
          className="absolute inset-0 block h-full w-full border-0"
          allow="clipboard-write"
          title="Pokemon Showdown"
        />
      </div>

      {/* Arena footer — collapsible, anchors flush to the iframe edge */}
      <ArenaFooter />
    </div>
  );
}
