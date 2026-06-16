/**
 * Lazy entry point for ShaderField so the WebGL/GLSL code is split into its own
 * chunk and never ships on the initial route bundle. Wrap usages in <Suspense>
 * with the matching static gradient (buildGradientCss) as the fallback so there
 * is no flash while the chunk loads.
 */

import { lazyWithReload } from '@/lib/lazy-with-reload';

export const ShaderField = lazyWithReload(() =>
  import('./shader-field').then(m => ({ default: m.ShaderField })),
);
