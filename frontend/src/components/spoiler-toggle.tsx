import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Header chip that flips the persisted `spoilerFreeMode` preference without a
 * trip to settings. Shown on the standings + replays pages. Toggling persists
 * (so it sticks across pages and sessions) and refreshes the auth context so
 * every <Spoiler> on screen reacts immediately.
 */
export function SpoilerToggle({ className }: { className?: string }) {
  const { spoilerFreeMode, refreshPreferences } = useAuth();
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      await api.updateMyPreferences({ spoilerFreeMode: !spoilerFreeMode });
      await refreshPreferences();
    } catch {
      /* non-fatal — leave the current state untouched */
    } finally {
      setSaving(false);
    }
  }

  const Icon = spoilerFreeMode ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      aria-pressed={spoilerFreeMode}
      title={spoilerFreeMode ? 'Spoilers hidden — click to show results' : 'Click to hide results (spoiler-free)'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        'disabled:opacity-50',
        spoilerFreeMode
          ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/15'
          : 'border-border-subtle text-text-muted hover:text-text-secondary hover:border-border',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {spoilerFreeMode ? 'Spoilers hidden' : 'Spoiler-free'}
    </button>
  );
}
