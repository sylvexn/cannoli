import type { CSSProperties } from 'react';

/** Mix two #RRGGBB hex colors at the given ratio (0 = a, 1 = b). */
export function blendHex(a: string, b: string, ratio = 0.5): string {
  const parse = (h: string): [number, number, number] => {
    const x = h.replace('#', '');
    if (x.length !== 6) return [0, 0, 0];
    return [
      parseInt(x.slice(0, 2), 16),
      parseInt(x.slice(2, 4), 16),
      parseInt(x.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * ratio);
  const g = Math.round(ag + (bg - ag) * ratio);
  const bl = Math.round(ab + (bb - ab) * ratio);
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
}

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 50];
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** Push a hex color toward a readable lightness floor on a near-black
 *  background. Below `minL` (default 55%), the lightness is lifted; deeply
 *  dark hues get a saturation boost so they don't read as washed grey after
 *  brightening (e.g. #530000 → a punchier crimson, not muddy maroon). */
export function readableOnDark(hex: string, minL = 55): string {
  const [h, s, l] = hexToHsl(hex);
  if (l >= minL) return hex;
  const newS = l < 25 ? Math.max(s, 65) : s;
  return hslToHex(h, newS, minL);
}

/* ---------- 1.4 team color rules ----------
   Team colors are never text on dark. They appear as slabs (solid areas) or
   tints (a fade into a row). Very dark colors vanish on the ink background and
   neon ones glare as big areas, so both ends get handled here. */

function luminance(hex: string): number {
  const x = hex.replace('#', '');
  if (x.length !== 6) return 0;
  return [0, 2, 4]
    .map(i => parseInt(x.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}

/** Text color (near-black or white) that reads on top of `hex`. */
export function onColor(hex: string): string {
  return luminance(hex) > 0.32 ? '#0b0d11' : '#ffffff';
}

/** True when `hex` is too dark to see on the ink background as-is. */
export function isDarkTeamColor(hex: string): boolean {
  return luminance(hex) < 0.06;
}

/** A team color for a big solid area (header slab, score bug). Neon colors are
 *  toned down ~28%; dark ones keep their true color (pair with `slabRing`). */
export function slabColor(hex: string): string {
  return luminance(hex) > 0.4 ? blendHex(hex, '#000000', 0.28) : hex;
}

/** Faint light outline for dark slabs so they separate from the page. */
export function slabRing(hex: string): string | undefined {
  return isDarkTeamColor(hex) ? 'inset 0 0 0 1px rgba(255,255,255,0.18)' : undefined;
}

/** A team color for tinted rows: dark colors are brightened until the tint
 *  actually shows; everything else passes through. */
export function tintColor(hex: string): string {
  let c = hex;
  for (let i = 0; i < 40 && luminance(c) < 0.07; i++) c = blendHex(c, '#ffffff', 0.07);
  return c;
}

/** Inline style for a row tinted with a team color fading in from the left. */
export function teamTintStyle(hex: string | null | undefined, strength = 30): CSSProperties | undefined {
  if (!hex) return undefined;
  return { backgroundImage: `linear-gradient(90deg, color-mix(in oklab, ${tintColor(hex)} ${strength}%, transparent), transparent 50%)` };
}
