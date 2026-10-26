/**
 * In-memory ring buffer of this process's console output, for the dev console
 * live tail. Lost on restart by design. Secrets are redacted BEFORE buffering.
 */
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSource = 'backend' | 'ps-bot';
/** Per-process id: seq restarts at 1 on every boot, so clients key their dedupe on (boot, n). */
export const BOOT_ID = Math.random().toString(36).slice(2, 10);
export interface LogLine { boot: string; n: number; t: number; src: LogSource; level: LogLevel; msg: string }

export const LOG_CAPACITY = 2000;
const MAX_LINE = 4000;

let buf: LogLine[] = [];
let seq = 0;
const listeners = new Set<(l: LogLine) => void>();

const REDACTIONS: [RegExp, string][] = [
  // Authorization / Cookie / Set-Cookie header values (rest of line)
  [/\b(authorization|proxy-authorization|cookie|set-cookie)(["']?\s*[:=]\s*)[^\n]*/gi, '$1$2[redacted]'],
  // Bearer / Basic credentials anywhere
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, '$1 [redacted]'],
  // key=value / "key": "value" for secret-ish keys
  [/(["']?\b[\w-]*(?:password|passwd|secret|token|api[_-]?key|sid|session|csrf|private[_-]?key)[\w-]*\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1[redacted]'],
  // PEM blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
];

export function redact(s: string): string {
  let out = s;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

export function pushLog(level: LogLevel, msg: string, src?: LogSource): LogLine {
  let clean = redact(msg);
  if (clean.length > MAX_LINE) clean = clean.slice(0, MAX_LINE) + '…';
  const line: LogLine = { boot: BOOT_ID, n: ++seq, t: Date.now(), src: src ?? (/^\[PS Bot\]/i.test(clean) ? 'ps-bot' : 'backend'), level, msg: clean };
  buf.push(line);
  if (buf.length > LOG_CAPACITY) buf = buf.slice(-LOG_CAPACITY); // ponytail: O(n) trim every push once full; fine at 2000
  for (const l of listeners) { try { l(line); } catch { /* listener errors never break logging */ } }
  return line;
}

export const getLogs = (limit = LOG_CAPACITY): LogLine[] => buf.slice(-limit);
export const subscribeLogs = (fn: (l: LogLine) => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export function resetLogBuffer() { buf = []; seq = 0; }

let installed = false;
/** Tee console.* into the buffer once, preserving original behaviour. */
export function installConsoleTee() {
  if (installed) return;
  installed = true;
  const map = { log: 'info', info: 'info', debug: 'debug', warn: 'warn', error: 'error' } as const;
  for (const k of Object.keys(map) as (keyof typeof map)[]) {
    const orig = console[k].bind(console);
    console[k] = (...args: unknown[]) => {
      orig(...args);
      try { pushLog(map[k], format(...args)); } catch { /* never throw from logging */ }
    };
  }
}
