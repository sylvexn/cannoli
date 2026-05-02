import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Map a Pokemon point cost (1-20) to the canonical tier hue used by TierBadge,
 * theorycraft pool chips, etc. Hue sweeps 270° → 0° (purple → red) as cost rises.
 * Inputs outside [1, 20] are clamped.
 */
export function tierToHslColor(tier: number): string {
  const clamped = Math.max(1, Math.min(20, tier));
  const hue = Math.round(270 - ((clamped - 1) / 19) * 270);
  return `hsl(${hue}, 75%, 45%)`;
}
