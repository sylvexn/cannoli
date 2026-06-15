import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, MessageSquarePlus } from 'lucide-react';
import { reportClientError } from '@/lib/report-error';
import { openFeedback } from '@/lib/feedback-bus';

interface Props {
  children: ReactNode;
  /** Optional reset key — when this changes, the boundary clears its error
   *  state. Pass the current pathname so navigating away from a broken page
   *  unsticks it without a full reload. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  /** Server-issued correlation ref for the captured crash, once reported. */
  errorId: string | null;
}

/**
 * Page-level error boundary. Catches render errors from any descendant and
 * renders a themed fallback consistent with the dark+neon aesthetic. Mounted
 * inside AppShell's <Outlet> wrapper so the sidebar/nav remain functional
 * even when a page crashes.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, errorId: null };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, errorId: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PageErrorBoundary]', error, info.componentStack);
    // Report the crash so it lands in the dev API Logs tab, and stash the
    // returned correlation ref for the "report this" issue + on-screen display.
    void reportClientError({
      kind: 'render',
      name: error.name,
      message: error.message,
      stack: error.stack,
    }).then(errorId => {
      if (errorId) this.setState({ errorId });
    });
  }

  handleReset = () => this.setState({ error: null, errorId: null });

  handleReport = () => {
    const message = this.state.error?.message ?? 'Unknown error';
    openFeedback({
      title: 'Page crash',
      description: `The page crashed with:\n\n${message}\n\nWhat I was doing: `,
      errorId: this.state.errorId ?? undefined,
    });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="rounded-full border border-loss/40 bg-loss/10 p-3 shadow-[0_0_24px_rgba(239,68,68,0.15)]">
          <AlertTriangle size={28} className="text-loss" />
        </div>
        <h2 className="mt-4 font-mono text-sm uppercase tracking-widest text-text-secondary">
          <span className="text-loss">Something</span>{' '}
          <span className="text-text-primary">went wrong</span>
        </h2>
        <p className="mt-2 max-w-md text-xs leading-relaxed text-text-muted">
          This page hit an unexpected error and couldn&rsquo;t finish rendering.
          The rest of the app is fine — try again, or navigate elsewhere.
        </p>
        {this.state.error.message && (
          <pre className="mt-4 max-w-xl overflow-x-auto rounded border border-border-subtle bg-surface-base px-3 py-2 text-left text-[11px] leading-snug text-text-muted">
            {this.state.error.message}
          </pre>
        )}
        {this.state.errorId && (
          <p className="mt-2 text-[11px] text-text-muted">
            Error ref <span className="font-mono text-text-secondary">{this.state.errorId}</span>
          </p>
        )}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/5 px-3 py-1.5 text-xs font-medium text-neon transition-colors hover:bg-neon/15 hover:border-neon/70"
          >
            <RefreshCw size={12} />
            Try again
          </button>
          <button
            type="button"
            onClick={this.handleReport}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-overlay px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-overlay/70 hover:text-text-primary"
          >
            <MessageSquarePlus size={12} />
            Report this
          </button>
        </div>
      </div>
    );
  }
}
