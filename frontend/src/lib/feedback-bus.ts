/**
 * Tiny pub/sub so anything (e.g. the page error boundary) can pop the global
 * FeedbackDialog with prefilled content, without threading props through the
 * tree. The dialog (mounted once in the sidebar footer) subscribes; callers
 * fire `openFeedback(prefill)`.
 */

export interface FeedbackPrefill {
  title?: string;
  description?: string;
  /** Correlation ref from a captured error — appended to the issue so the
   *  report ties back to a request_logs row. */
  errorId?: string;
}

type Listener = (prefill: FeedbackPrefill) => void;

const listeners = new Set<Listener>();

/** Open the feedback dialog, optionally pre-filling fields. */
export function openFeedback(prefill: FeedbackPrefill = {}) {
  listeners.forEach(l => l(prefill));
}

/** Subscribe (used by FeedbackDialog). Returns an unsubscribe fn. */
export function onOpenFeedback(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
