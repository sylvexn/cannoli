/**
 * Wrap a state update in `document.startViewTransition` when the API exists.
 * Browsers without the API (Firefox/Safari pre-18) just run the update
 * synchronously, so call sites don't need feature-detect branching.
 *
 * Use sparingly — wrap **batch** state changes (filter dropdowns, sort
 * toggles, route changes) but never per-keystroke updates: starting a VT on
 * every input event causes visible flicker because the browser has to snapshot
 * the page at 60Hz. Search inputs should remain unwrapped.
 */
export function withViewTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => update());
  } else {
    update();
  }
}
