import { useEffect } from 'react';
import { api } from './api';
import { useAuth } from './auth-context';

/**
 * On login, silently sync feedback resolutions: the backend checks whether any
 * GitHub issues the user reported have been closed and, if so, drops a directed
 * entry into the notifications pane (idempotent). No toast — resolutions now
 * surface in the pane alongside changelog/announcements/match reminders.
 */
export function useFeedbackNotifications() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    // Small delay to let the app settle after login.
    const timer = setTimeout(() => {
      api.syncFeedbackResolutions().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [isAuthenticated, user?.id]);
}
