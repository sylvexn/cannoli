/**
 * gpu-capability.ts — one-time, memoized detection of whether the browser is
 * actually GPU-accelerated, so we can disable continuous WebGL/CSS animations
 * for users on software renderers or weak hardware (and not slow them down).
 *
 * Tiers:
 *   'accelerated' — real GPU; safe to run the shader loop + continuous anims.
 *   'software'    — software renderer (SwiftShader/llvmpipe/…) or low-end device.
 *   'none'        — no WebGL at all.
 *
 * `applyGpuAttr()` sets `<html data-gpu="…">` once at boot so CSS can gate too
 * (see the `:root[data-gpu='software']` block in index.css). The signal is
 * intentionally conservative: when in doubt we bias toward 'software' because the
 * fallback (a designed static gradient) looks good — we'd rather skip the loop
 * than stutter on someone's machine.
 */

export type GpuTier = 'accelerated' | 'software' | 'none';

export interface GpuInfo {
  tier: GpuTier;
  /** UNMASKED_RENDERER_WEBGL string, or null if blocked/unavailable. */
  renderer: string | null;
  /** Short diagnostic for logging / ?debug. */
  reason: string;
}

const OVERRIDE_KEY = 'cannoli:gpu-override';

// Case-insensitive substring matches against the unmasked renderer string.
// `apple paravirtual` = VM/CI, treated as software so headless runs don't loop.
const SOFTWARE_RENDERER_DENYLIST = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'software',
  'microsoft basic render',
  'angle (software',
  'mesa offscreen',
  'apple paravirtual',
];

function isTier(v: string | null): v is GpuTier {
  return v === 'accelerated' || v === 'software' || v === 'none';
}

/** Manual override via `?gpu=` (persisted) or localStorage — for QA + Playwright. */
function readOverride(): GpuTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('gpu');
    if (isTier(q)) {
      try { window.localStorage.setItem(OVERRIDE_KEY, q); } catch { /* private mode */ }
      return q;
    }
  } catch { /* malformed URL */ }
  try {
    const stored = window.localStorage.getItem(OVERRIDE_KEY);
    return isTier(stored) ? stored : null;
  } catch {
    return null;
  }
}

function makeGl(attrs?: WebGLContextAttributes): WebGLRenderingContext | null {
  const c = document.createElement('canvas');
  return (c.getContext('webgl', attrs) ||
    c.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
}

function readRenderer(gl: WebGLRenderingContext): string | null {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    // May be null under Firefox privacy.resistFingerprinting / Tor.
    if (!dbg) return null;
    return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
  } catch {
    return null;
  }
}

function loseContext(gl: WebGLRenderingContext): void {
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* ignore */ }
}

function classify(): GpuInfo {
  if (typeof document === 'undefined') {
    return { tier: 'none', renderer: null, reason: 'no-document' };
  }

  const override = readOverride();
  if (override) return { tier: override, renderer: null, reason: 'override' };

  try {
    // failIfMajorPerformanceCaveat:true => browser returns null rather than a
    // software/blocklisted fallback. The strongest single signal.
    const accelGl = makeGl({
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'low-power',
      depth: false,
      antialias: false,
      alpha: true,
    });

    if (!accelGl) {
      // Re-probe without the flag to distinguish "no WebGL" from "refused accel".
      const plain = makeGl();
      if (!plain) return { tier: 'none', renderer: null, reason: 'no-webgl' };
      const renderer = readRenderer(plain);
      loseContext(plain);
      return { tier: 'software', renderer, reason: 'perf-caveat' };
    }

    const renderer = readRenderer(accelGl);
    loseContext(accelGl);

    // Belt-and-suspenders: some software renderers don't trip the caveat flag.
    if (renderer && SOFTWARE_RENDERER_DENYLIST.some(s => renderer.toLowerCase().includes(s))) {
      return { tier: 'software', renderer, reason: 'denylist' };
    }

    // Secondary signals — only ever DOWNGRADE accelerated→software, never upgrade.
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    // deviceMemory is Chromium-only; undefined elsewhere → no signal.
    const mem = typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined;
    if ((typeof cores === 'number' && cores <= 2) || (typeof mem === 'number' && mem <= 1)) {
      return { tier: 'software', renderer, reason: 'low-end-device' };
    }

    return { tier: 'accelerated', renderer, reason: 'accelerated' };
  } catch {
    // Never let detection crash bootstrap.
    return { tier: 'none', renderer: null, reason: 'exception' };
  }
}

let cached: GpuInfo | null = null;

export function getGpuInfo(): GpuInfo {
  return (cached ??= classify());
}

export function getGpuTier(): GpuTier {
  return getGpuInfo().tier;
}

/** Set `<html data-gpu="…">` once so CSS can gate continuous animations. */
export function applyGpuAttr(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-gpu', getGpuTier());
}
