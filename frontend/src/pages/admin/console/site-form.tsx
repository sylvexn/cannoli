import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { getErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

export interface SiteSettings {
  defaultUserPassword: string;
  draftTimerEnabled: boolean;
  draftDemoVisible: boolean;
}

const DEFAULTS: SiteSettings = { defaultUserPassword: 'password', draftTimerEnabled: true, draftDemoVisible: true };

/** Loads site settings and tracks which keys differ from the last saved baseline. */
export function useSiteSettings() {
  const [saved, setSaved] = useState<SiteSettings>(DEFAULTS);
  const [draft, setDraft] = useState<SiteSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSiteSettings()
      .then(s => {
        const v: SiteSettings = {
          defaultUserPassword: s.defaultUserPassword ?? DEFAULTS.defaultUserPassword,
          draftTimerEnabled: s.draftTimerEnabled ?? true,
          draftDemoVisible: s.draftDemoVisible ?? true,
        };
        setSaved(v); setDraft(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const dirtyKeys = useMemo(
    () => (Object.keys(draft) as (keyof SiteSettings)[]).filter(k => draft[k] !== saved[k]),
    [draft, saved],
  );
  const set = useCallback(<K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setDraft(p => ({ ...p, [k]: v })), []);
  const discard = useCallback(() => setDraft(saved), [saved]);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.saveSiteSettings(draft as unknown as Record<string, unknown>);
      setSaved(draft);
      toast.success('Settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [draft]);

  return { draft, loading, saving, dirtyKeys, set, discard, save };
}

type Site = ReturnType<typeof useSiteSettings>;

function Row({ id, label, hint, hit, dirty, children }: { id: string; label: string; hint: string; hit: boolean; dirty: boolean; children: React.ReactNode }) {
  return (
    <div id={`set-${id}`} className={cn('flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-3 py-2.5 rounded-md border transition-colors scroll-mt-24',
      hit ? 'border-neon/60 bg-neon/10 ring-1 ring-neon/30' : 'border-transparent hover:bg-surface-overlay/30')}>
      <div className="min-w-0 sm:flex-1">
        <div className="text-sm text-text-primary flex items-center gap-2">
          {label}
          {dirty && <span className="size-1.5 rounded-full bg-pink shrink-0" title="Unsaved change" />}
        </div>
        <div className="text-[11px] text-text-muted">{hint}</div>
      </div>
      <div className="sm:w-60 shrink-0">{children}</div>
    </div>
  );
}

export function GeneralFields({ site, hits }: { site: Site; hits: Set<string> }) {
  const { draft, dirtyKeys, set } = site;
  return (
    <Row id="defaultUserPassword" label="Default user password" hit={hits.has('defaultUserPassword')} dirty={dirtyKeys.includes('defaultUserPassword')}
      hint="New accounts and password resets use this. Users must change it on first login.">
      <Input value={draft.defaultUserPassword} onChange={e => set('defaultUserPassword', e.target.value)} placeholder="password" className="font-mono" />
    </Row>
  );
}

export function DraftFields({ site, hits }: { site: Site; hits: Set<string> }) {
  const { draft, dirtyKeys, set } = site;
  return (
    <>
      <Row id="draftTimerEnabled" label="Enable pick timer" hit={hits.has('draftTimerEnabled')} dirty={dirtyKeys.includes('draftTimerEnabled')}
        hint="When disabled, players have unlimited time per pick.">
        <Switch checked={draft.draftTimerEnabled} onCheckedChange={v => set('draftTimerEnabled', v)} />
      </Row>
      <Row id="draftDemoVisible" label="Show demo mode" hit={hits.has('draftDemoVisible')} dirty={dirtyKeys.includes('draftDemoVisible')}
        hint="When hidden, only Season and Live modes are available on the draft board.">
        <Switch checked={draft.draftDemoVisible} onCheckedChange={v => set('draftDemoVisible', v)} />
      </Row>
    </>
  );
}
