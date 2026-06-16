import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { MessageSquarePlus, Loader2, Camera } from 'lucide-react';
import { api, type FeedbackCategory } from '@/lib/api';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import { onOpenFeedback } from '@/lib/feedback-bus';
import { captureScreenshot } from '@/lib/capture-screenshot';
import { cn } from '@/lib/utils';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug Report' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'league', label: 'League & Rules' },
  { value: 'general', label: 'General' },
];

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [screenshotEnabled, setScreenshotEnabled] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { pathname } = useLocation();

  // Allow other surfaces (e.g. the page error boundary) to open this dialog
  // prefilled — e.g. "report this crash" carries the error correlation ref.
  useEffect(() => onOpenFeedback(prefill => {
    if (prefill.title !== undefined) setTitle(prefill.title);
    if (prefill.description !== undefined) setDescription(prefill.description);
    setErrorRef(prefill.errorId ?? null);
    if (prefill.category !== undefined) setCategory(prefill.category);
    if (prefill.screenshot !== undefined) setScreenshotEnabled(prefill.screenshot);
    setOpen(true);
  }), []);

  function handleClose() {
    if (capturing) return;
    setOpen(false);
    setTitle('');
    setDescription('');
    setErrorRef(null);
    setCategory('general');
    setScreenshotEnabled(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);

    let screenshot: File | undefined;
    if (screenshotEnabled) {
      // Hide the dialog visually so the modal isn't part of the capture.
      setCapturing(true);
      // A short rAF tick lets React flush the opacity change before capture.
      await new Promise(res => requestAnimationFrame(res));
      const result = await captureScreenshot();
      setCapturing(false);
      if (result) {
        screenshot = result;
      } else {
        toast('Couldn\'t capture a screenshot — submitting without it');
      }
    }

    try {
      const res = await api.submitFeedback({
        category,
        title: title.trim(),
        description: description.trim(),
        page: pathname,
        errorRef: errorRef ?? undefined,
        screenshot,
      });
      toast.success(res.issueNumber
        ? `Feedback submitted (#${res.issueNumber})`
        : 'Feedback submitted');
      handleClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit feedback'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors"
      >
        <MessageSquarePlus size={14} />
        <span>Send Feedback</span>
      </button>

      <Dialog open={open} onOpenChange={o => { if (!o) handleClose(); }}>
        <DialogContent
          className={cn(
            'sm:max-w-md transition-opacity duration-75',
            capturing && 'opacity-0 pointer-events-none',
          )}
        >
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Report a bug or suggest an improvement. This creates a tracked issue for review.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Category selector */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-primary">Category</label>
              <div className="flex gap-1 rounded-md border border-border-default p-0.5">
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    className={cn(
                      'flex-1 px-2 py-1 text-xs font-medium rounded transition-colors',
                      category === cat.value
                        ? 'bg-surface-overlay text-text-primary'
                        : 'text-text-muted hover:text-text-secondary',
                    )}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Title</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Brief summary..."
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Description</label>
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What happened? What did you expect? Steps to reproduce..."
                rows={5}
              />
            </div>

            {/* Screenshot opt-in */}
            <div className="flex items-center gap-3">
              <Switch
                size="sm"
                checked={screenshotEnabled}
                onCheckedChange={setScreenshotEnabled}
                id="screenshot-switch"
              />
              <div className="flex flex-col gap-0.5">
                <label htmlFor="screenshot-switch" className="text-sm text-text-primary cursor-pointer flex items-center gap-1.5">
                  <Camera size={13} className="text-text-muted" />
                  Include a screenshot of my screen
                </label>
                <span className="text-xs text-text-muted">Captured when you submit.</span>
              </div>
            </div>

            <div className="text-xs text-text-muted">
              Current page ({pathname}) will be included automatically.
            </div>

            {errorRef && (
              <div className="text-xs text-text-muted">
                Error ref <span className="font-mono text-text-secondary">{errorRef}</span> is attached so it can be traced.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleClose} disabled={capturing}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || !description.trim() || submitting || capturing}
              >
                {(submitting || capturing) ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Submit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
