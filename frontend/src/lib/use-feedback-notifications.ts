import { useEffect } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import { useAuth } from './auth-context';

/**
 * On login, check for resolved feedback issues and show persistent toasts.
 * Each toast requires acknowledgment (dismiss or click) and won't reappear.
 */
export function useFeedbackNotifications() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Small delay to let the app settle after login
    const timer = setTimeout(() => {
      api.getFeedbackNotifications().then(notifications => {
        for (const n of notifications) {
          toast.success(`Your feedback "${n.title}" has been addressed!`, {
            duration: Infinity,
            action: {
              label: 'View Issue',
              onClick: () => {
                window.open(n.issueUrl, '_blank');
                api.acknowledgeFeedback(n.issueNumber).catch(() => {});
              },
            },
            onDismiss: () => {
              api.acknowledgeFeedback(n.issueNumber).catch(() => {});
            },
          });
        }
      }).catch(() => {});
    }, 1500);

    return () => clearTimeout(timer);
  }, [isAuthenticated, user?.id]);
}
