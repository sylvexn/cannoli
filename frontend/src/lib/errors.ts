/**
 * Shared error helpers.
 *
 * `lib/api.ts` throws a plain `Error` augmented with structured fields from the
 * backend's JSON error body (`.body`, `.status`, `.code`). `ApiError` types that
 * shape so callers can narrow without `any`, and `getErrorMessage` safely pulls
 * a human-readable string out of an `unknown` caught value (the type of a
 * `catch (err: unknown)` binding) — no more unsafe `err.message` on non-Errors.
 */

/** The error shape `apiFetch` attaches to thrown errors (see lib/api.ts). */
export interface ApiError extends Error {
  /** Parsed JSON error body from the backend (e.g. `{ error, code, ... }`). */
  body?: { error?: string; code?: string; [k: string]: unknown };
  /** HTTP status code. */
  status?: number;
  /** Structured error code copied from `body.code` when present. */
  code?: string;
}

/** Type guard: is this an Error-like object with our API augmentations? */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof Error;
}

/**
 * Best-effort human-readable message from an unknown thrown value.
 * Handles real Errors, API-augmented Errors (prefers the backend `body.error`),
 * plain strings, and `{ message }`-shaped objects; falls back to `fallback`.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error) {
    const body = (err as ApiError).body;
    if (body && typeof body.error === 'string' && body.error) return body.error;
    if (err.message) return err.message;
    return fallback;
  }
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}
