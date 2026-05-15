/**
 * Sim-mode guard.
 *
 * The season simulator writes synthetic results straight into the live result
 * pipeline. That is only ever safe on the mock deployment (`CANNOLI_MODE=mock`),
 * which runs against the disposable `cannoli-mock-data` volume. Every simulator
 * entry point must call {@link assertMockMode} before touching the DB so a
 * mis-routed request can never corrupt the real `cannoli-backend-live` DB.
 */

/** True when this process is the mock deployment. */
export function isMock(): boolean {
  return process.env.CANNOLI_MODE === 'mock';
}

/** Throws unless running in mock mode. Call at the top of every sim writer. */
export function assertMockMode(): void {
  if (!isMock()) {
    throw new Error(
      'Season simulator is mock-only — refusing to run with ' +
        `CANNOLI_MODE=${process.env.CANNOLI_MODE ?? '(unset)'}`,
    );
  }
}
