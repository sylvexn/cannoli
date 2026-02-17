import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquarePlus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { pathname } = useLocation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    try {
      const res = await api.submitFeedback(title.trim(), description.trim(), pathname);
      toast.success(`Feedback submitted (#${res.issueNumber})`);
      setOpen(false);
      setTitle('');
      setDescription('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit feedback');
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Report a bug or suggest an improvement. This creates a tracked issue for review.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <div className="text-xs text-text-muted">
              Current page ({pathname}) will be included automatically.
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || !description.trim() || submitting}>
                {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Submit
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
