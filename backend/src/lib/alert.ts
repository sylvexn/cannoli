/**
 * Discord webhook alerting — observability layer for errors, feedback, and
 * health-probe flips.
 *
 * Design goals:
 *   - Fire-and-forget: every exported function returns void and NEVER throws.
 *     The caller does not await anything; alerts must not slow down requests.
 *   - Self-disabling: if a webhook env var is absent, that stream is silently
 *     skipped — same pattern as GITHUB_TOKEN usage elsewhere in the codebase.
 *   - Coalescing: a runaway error loop posts at most one message per 60 s per
 *     fingerprint; the window rolls up the suppressed count in a final post.
 *   - Re-entrancy guard: an exception thrown *inside* this module cannot
 *     recurse back into the alert pipeline.
 *
 * Env vars (all optional):
 *   DISCORD_ERROR_WEBHOOK    — errors / health flips
 *   DISCORD_FEEDBACK_WEBHOOK — feedback; falls back to error webhook if unset
 *   PUBLIC_BASE_URL          — base for deep-link URLs (default cannoli.live)
 */

// Config

const ERROR_WEBHOOK = process.env.DISCORD_ERROR_WEBHOOK ?? null;
const FEEDBACK_WEBHOOK = process.env.DISCORD_FEEDBACK_WEBHOOK ?? ERROR_WEBHOOK;
const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'https://cannoli.live';

/** Window length (ms) during which duplicate fingerprints are coalesced. */
const COALESCE_WINDOW_MS = 60_000;

/** Discord embed colors (decimal). */
const COLOR = {
  red: 0xe53e3e,
  orange: 0xed8936,
  gray: 0x718096,
  blue: 0x4299e1,
  green: 0x48bb78,
} as const;

// Re-entrancy guard

/** True while we are inside any alert dispatch — prevents recursive alerting
 *  if something in this module itself throws and an upstream handler calls
 *  alertFault again. */
let _dispatching = false;

// Coalescing state

interface CoalesceEntry {
  /** Extra occurrences accumulated during the open window. */
  extra: number;
  /** setTimeout handle for the rollup post. */
  timer: ReturnType<typeof setTimeout>;
  /** Args from the first occurrence — used for the rollup embed. */
  firstArgs: Parameters<typeof alertFault>[0];
}

const coalesceMap = new Map<string, CoalesceEntry>();

// Internal helpers

/** Truncate a string to `max` chars, appending "…" if cut. */
function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordField[];
  timestamp?: string;
}

/** Raw Discord webhook POST. Returns the Response (or null on network error).
 *  Handles HTTP 429: reads retry-after and retries once via setTimeout so the
 *  retry is fully detached and never blocks the caller. */
function postWebhook(webhookUrl: string, embed: DiscordEmbed): void {
  const body = JSON.stringify({ embeds: [embed] });

  void (async () => {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (res.status === 429) {
        // Rate-limited — retry once after the server-specified delay.
        let retryAfterMs = 1_000;
        try {
          const data = (await res.json()) as { retry_after?: number };
          if (typeof data.retry_after === 'number') {
            // Discord returns retry_after in seconds (float).
            retryAfterMs = Math.ceil(data.retry_after * 1_000);
          }
        } catch {
          /* malformed JSON — use default delay */
        }
        setTimeout(() => {
          void fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          }).catch(() => {
            /* drop on second failure */
          });
        }, retryAfterMs);
      }
      // All other non-2xx responses (e.g. 400 bad embed, 404 unknown webhook)
      // are silently dropped — we do not want retry loops for permanent errors.
    } catch {
      /* network error — drop silently */
    }
  })();
}

/** Build the deep-link URL to the observability group page. */
function groupUrl(groupId: number | null | undefined): string | undefined {
  if (!groupId) return undefined;
  return `${BASE_URL}/admin/observability?group=${groupId}`;
}

// alertFault

/**
 * Post a Discord alert for a server-side or client-side error group.
 *
 * Coalescing contract:
 *   - First occurrence of a fingerprint → post immediately, open a 60 s window.
 *   - Subsequent occurrences within the window → increment counter only.
 *   - When the window closes → if extra > 0, post one rollup message.
 *   - isNew always posts immediately (escalation) but still respects the window
 *     for any *further* occurrences that arrive after it.
 */
export function alertFault(args: {
  groupId?: number | null;
  fingerprint: string;
  kind: string;
  errorName: string | null;
  message: string;
  path: string | null;
  count: number;
  affectedUsers: number;
  errorRef?: string | null;
  version: string;
  isNew: boolean;
  isSpike: boolean;
}): void {
  if (!ERROR_WEBHOOK) return;
  if (_dispatching) return;

  try {
    _dispatching = true;
    _alertFault(args);
  } finally {
    _dispatching = false;
  }
}

function _alertFault(args: Parameters<typeof alertFault>[0]): void {
  const { fingerprint, isNew } = args;

  const existing = coalesceMap.get(fingerprint);

  if (existing) {
    // Window is open. isNew escalation still posts; everything else coalesces.
    if (isNew) {
      _postFaultEmbed(args);
    } else {
      existing.extra += 1;
    }
    return;
  }

  // First occurrence — post immediately and open the coalesce window.
  _postFaultEmbed(args);

  const entry: CoalesceEntry = {
    extra: 0,
    firstArgs: args,
    timer: setTimeout(() => {
      coalesceMap.delete(fingerprint);
      if (entry.extra > 0) {
        _postRollup(entry.firstArgs, entry.extra);
      }
    }, COALESCE_WINDOW_MS),
  };
  coalesceMap.set(fingerprint, entry);
}

function _postFaultEmbed(args: Parameters<typeof alertFault>[0]): void {
  const { groupId, kind, errorName, message, path, count, affectedUsers, errorRef, version, isNew, isSpike } = args;

  let title: string;
  let color: number;

  if (isNew) {
    title = '🔴 NEW ERROR';
    color = COLOR.red;
  } else if (isSpike) {
    title = '📈 SPIKE';
    color = COLOR.orange;
  } else {
    title = '⚠ Error';
    color = COLOR.gray;
  }

  const fields: DiscordField[] = [
    { name: 'Kind', value: kind || 'unknown', inline: true },
    { name: 'Version', value: version || 'unknown', inline: true },
    { name: 'Count', value: String(count), inline: true },
    { name: 'Affected Users', value: String(affectedUsers), inline: true },
  ];

  if (path) {
    fields.push({ name: 'Path', value: trunc(path, 200), inline: true });
  }
  if (errorName) {
    fields.push({ name: 'Error Name', value: trunc(errorName, 200), inline: true });
  }
  if (errorRef) {
    fields.push({ name: 'Error Ref', value: trunc(errorRef, 100), inline: false });
  }

  const deepLink = groupUrl(groupId);
  const embed: DiscordEmbed = {
    title,
    description: trunc(message, 500),
    color,
    fields,
    timestamp: new Date().toISOString(),
    ...(deepLink ? { url: deepLink } : {}),
  };

  postWebhook(ERROR_WEBHOOK!, embed);
}

function _postRollup(firstArgs: Parameters<typeof alertFault>[0], extra: number): void {
  const { groupId, fingerprint } = firstArgs;
  const deepLink = groupUrl(groupId);

  const embed: DiscordEmbed = {
    title: '🔁 Coalesced',
    description: `+${extra} more occurrence${extra === 1 ? '' : 's'} of \`${trunc(fingerprint, 120)}\` in the last ${COALESCE_WINDOW_MS / 1_000}s`,
    color: COLOR.gray,
    timestamp: new Date().toISOString(),
    ...(deepLink ? { url: deepLink } : {}),
  };

  postWebhook(ERROR_WEBHOOK!, embed);
}

// alertFeedback

/**
 * Post a Discord embed for a user feedback submission.
 * No coalescing — every submission is distinct and low-volume.
 */
export function alertFeedback(args: {
  title: string;
  description: string;
  page?: string | null;
  reporter: string;
  role: string;
  errorRef?: string | null;
  issueUrl?: string | null;
  /** Feedback category: 'bug' | 'feature' | 'league' | 'general' */
  category?: string | null;
}): void {
  if (!FEEDBACK_WEBHOOK) return;
  if (_dispatching) return;

  try {
    _dispatching = true;

    const { title, description, page, reporter, role, errorRef, issueUrl, category } = args;

    const fields: DiscordField[] = [
      { name: 'Reporter', value: `${reporter} (${role})`, inline: true },
    ];

    if (category) {
      fields.push({ name: 'Category', value: category, inline: true });
    }
    if (page) {
      fields.push({ name: 'Page', value: trunc(page, 200), inline: true });
    }
    if (errorRef) {
      fields.push({ name: 'Error Ref', value: trunc(errorRef, 100), inline: true });
    }
    if (issueUrl) {
      fields.push({ name: 'Issue', value: issueUrl, inline: false });
    }

    const embed: DiscordEmbed = {
      title: trunc(title, 200),
      description: trunc(description, 1_000),
      color: COLOR.blue,
      fields,
      timestamp: new Date().toISOString(),
    };

    postWebhook(FEEDBACK_WEBHOOK, embed);
  } finally {
    _dispatching = false;
  }
}

// alertHealthFlip

/**
 * Post a Discord embed when a health-probe transitions state.
 * Color encodes severity: green = recovery, orange = degraded, red = down.
 */
export function alertHealthFlip(args: {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  detail?: string | null;
}): void {
  if (!ERROR_WEBHOOK) return;
  if (_dispatching) return;

  try {
    _dispatching = true;

    const { name, status, detail } = args;

    const colorMap = { ok: COLOR.green, degraded: COLOR.orange, down: COLOR.red } as const;
    const labelMap = { ok: '✅ Recovered', degraded: '⚠ Degraded', down: '🔴 Down' } as const;

    const embed: DiscordEmbed = {
      title: `${labelMap[status]}: ${name}`,
      description: detail ? trunc(detail, 500) : undefined,
      color: colorMap[status],
      timestamp: new Date().toISOString(),
    };

    postWebhook(ERROR_WEBHOOK, embed);
  } finally {
    _dispatching = false;
  }
}
