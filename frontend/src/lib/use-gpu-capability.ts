/**
 * useGpuTier — read the cached GPU tier (see gpu-capability.ts).
 *
 * Detection is one-time + memoized at module scope, so the value is effectively
 * constant for the page lifetime; no live subscription is needed (GPU tier does
 * not change at runtime). A `useState` initializer keeps it stable across renders.
 */

import { useState } from 'react';
import { getGpuTier, type GpuTier } from './gpu-capability';

export function useGpuTier(): GpuTier {
  const [tier] = useState<GpuTier>(() => getGpuTier());
  return tier;
}
