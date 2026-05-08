import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Loads admin-controlled draft settings (timer enabled, demo visibility) from
 * the site settings endpoint. Defaults both to `true` until the fetch resolves
 * so the UI doesn't flicker hidden state on first paint. The backend itself
 * scopes the demo-visible default to mock mode (mock=true, live=false) when
 * the row hasn't been configured.
 */
export function useDraftSettings() {
  const [draftTimerEnabled, setDraftTimerEnabled] = useState(true);
  const [draftDemoVisible, setDraftDemoVisible] = useState(true);

  useEffect(() => {
    api.getSiteSettings().then(s => {
      setDraftTimerEnabled(s.draftTimerEnabled ?? true);
      setDraftDemoVisible(s.draftDemoVisible ?? true);
    }).catch(() => {});
  }, []);

  return { draftTimerEnabled, draftDemoVisible };
}
