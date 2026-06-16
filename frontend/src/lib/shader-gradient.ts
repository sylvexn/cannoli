/**
 * shader-gradient.ts — synchronous, dependency-free helpers shared by ShaderField
 * and its Suspense fallback. Kept OUT of the lazy WebGL chunk so the static
 * gradient is always available immediately: first paint, while the shader chunk
 * loads, under reduced-motion, and on software/no GPU.
 */

/** 4-stop palettes per league gem, sampled from the .league-banner-* gradients. */
const GEM_PALETTES: Record<string, string[]> = {
  sapphire: ['#0b1e54', '#1d4ed8', '#3b82f6', '#60a5fa'],
  emerald: ['#06301a', '#15803d', '#16a34a', '#34d399'],
  ruby: ['#3f0710', '#b91c1c', '#ef4444', '#fb7185'],
};

/** Brand palette for league-agnostic surfaces (e.g. the login background). */
export const BRAND_PALETTE = ['#0a1830', '#1d4ed8', '#22d3ee', '#e879f9'];

export function gemPaletteFor(gem: string): string[] {
  return GEM_PALETTES[gem] ?? BRAND_PALETTE;
}

function padColors(colors: string[]): [string, string, string, string] {
  return [0, 1, 2, 3].map(i => colors[i] ?? BRAND_PALETTE[i]) as [string, string, string, string];
}

/**
 * A multi-radial static gradient built from up to 4 color stops — the "frozen
 * frame" of the shader. Used as the Suspense fallback and the runtime fallback
 * when the GPU is software/absent or reduced-motion is requested.
 */
export function buildGradientCss(colors: string[]): string {
  const [c0, c1, c2, c3] = padColors(colors);
  return [
    `radial-gradient(ellipse 70% 80% at 18% 22%, ${c0}, transparent 60%)`,
    `radial-gradient(ellipse 64% 72% at 82% 28%, ${c1}, transparent 58%)`,
    `radial-gradient(ellipse 80% 64% at 62% 86%, ${c2}, transparent 62%)`,
    `linear-gradient(135deg, ${c3}, #050509 78%)`,
  ].join(', ');
}
