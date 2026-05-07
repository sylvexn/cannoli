import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Optional reset key — when this changes, the boundary clears its error
   *  state. Pass the current pathname so navigating away from a broken page
   *  unsticks it without a full reload. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Page-level error boundary. Catches render errors from any descendant and
 * renders a themed fallback consistent with the dark+neon aesthetic. Mounted
 * inside AppShell's <Outlet> wrapper so the sidebar/nav remain functional
 * even when a page crashes.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console for dev — real telemetry hook can replace this later.
    console.error('[PageErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => this.setState({ error: null });

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
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/5 px-3 py-1.5 text-xs font-medium text-neon transition-colors hover:bg-neon/15 hover:border-neon/70"
        >
          <RefreshCw size={12} />
          Try again
        </button>
      </div>
    );
  }
}
