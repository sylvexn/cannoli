import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { getErrorMessage } from '@/lib/errors';
import { isLocalId } from '@/lib/draft-center/local-store';
import type { DcTeam } from '@/lib/draft-center/types';

export const sharePath = (token: string) => `/draft-center/s/${token}`;

/** Per-team "shareable" toggle. Private by default; the link carries an unguessable token. */
export function SharePopover({ team, onSetShared }: { team: DcTeam; onSetShared: (enabled: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const local = isLocalId(team.id);
  const shared = !!team.shareToken;
  const url = team.shareToken ? `${window.location.origin}${sharePath(team.shareToken)}` : '';

  async function toggle(enabled: boolean) {
    setBusy(true);
    try { await onSetShared(enabled); } catch (e) { toast.error(getErrorMessage(e)); } finally { setBusy(false); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('Could not copy - select the link and copy it manually'); }
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className={shared ? 'text-neon border-neon/40' : ''} />}>
        <Share2 size={13} /> {shared ? 'Shared' : 'Share'}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {local ? (
          <p className="text-xs text-text-secondary">
            Teams saved in this browser are private. <Link to="/login" className="text-neon hover:underline">Log in</Link> and import them to get a shareable link.
          </p>
        ) : (
          <>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-sm font-medium">Shareable link</span>
                <span className="block text-[11px] text-text-muted">Anyone with the link can view this team read-only.</span>
              </span>
              <Switch checked={shared} disabled={busy} onCheckedChange={toggle} />
            </label>
            {shared && (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-1.5">
                  <Input readOnly value={url} onFocus={e => e.currentTarget.select()} className="h-7 text-[11px] font-mono" aria-label="Share link" />
                  <Button size="icon-sm" variant="outline" onClick={copy} aria-label="Copy link">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </Button>
                  <Button size="icon-sm" variant="outline" nativeButton={false} render={<Link to={sharePath(team.shareToken!)} target="_blank" />} aria-label="Open link">
                    <ExternalLink size={13} />
                  </Button>
                </div>
                <p className="text-[10px] text-text-muted">Turning sharing off revokes this link; turning it back on creates a new one.</p>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
