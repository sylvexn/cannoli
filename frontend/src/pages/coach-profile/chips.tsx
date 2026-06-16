/**
 * Small pure chip/badge sub-components extracted from coach-profile/index.tsx
 * to keep that file under the 600-LOC standard. All presentational, no state.
 */
import { Shield, Crown, Medal, Bot } from 'lucide-react';

export function TeamColorChip({ color, abbrev }: { color: string; abbrev: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider shrink-0"
      style={{
        backgroundColor: `${color}22`,
        color,
        boxShadow: `inset 0 0 0 1px ${color}80`,
      }}
      title={`Team: ${abbrev}`}
    >
      <span
        className="w-2 h-2 rounded-sm shrink-0"
        style={{ backgroundColor: color }}
      />
      {abbrev}
    </span>
  );
}

/** ADMIN / DEV chip in the identity strip. Mirrors the styling used in
 *  CoachLink so the chip reads consistently across surfaces. */
export function RoleChip({ role }: { role: 'admin' | 'dev' | 'bot' }) {
  if (role === 'dev') {
    return (
      <span
        aria-label="dev"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider shrink-0 bg-neon/15 text-neon ring-1 ring-neon/30"
        title="Dev"
      >
        <Shield size={9} />
        Dev
      </span>
    );
  }
  if (role === 'bot') {
    return (
      <span
        aria-label="Bot"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider shrink-0 bg-violet-400/15 text-violet-400 ring-1 ring-violet-400/30"
        title="Bot"
      >
        <Bot size={9} />
        Bot
      </span>
    );
  }
  return (
    <span
      aria-label="Elder"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider shrink-0 bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
      title="Elder"
    >
      <Shield size={9} />
      Elder
    </span>
  );
}

export function FinishBadge({
  finish,
}: {
  finish: { position: number; label: string };
}) {
  // Champion: gold + crown. Runner-up: silver + medal. Below: muted.
  if (finish.position === 1) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
        <Crown size={10} />
        {finish.label}
      </span>
    );
  }
  if (finish.position === 2) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-300">
        <Medal size={10} />
        {finish.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-text-secondary">
      {finish.label}
    </span>
  );
}
