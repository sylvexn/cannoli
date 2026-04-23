import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSprite } from '@/components/loading-sprite';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { ApiFeedbackIssue } from '@/lib/api';
import {
  ExternalLink, CircleDot, CircleCheck, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react';

type FilterState = 'open' | 'closed' | 'all';

export function AdminFeedback() {
  const [issues, setIssues] = useState<ApiFeedbackIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterState>('open');
  const [error, setError] = useState<string | null>(null);

  const [unconfigured, setUnconfigured] = useState(false);

  function load(state: FilterState) {
    if (unconfigured) return;
    setLoading(true);
    setError(null);
    api.getFeedbackIssues(state)
      .then(setIssues)
      .catch(e => {
        const msg = e.message || '';
        if (msg.includes('not configured') || msg.includes('503')) {
          setUnconfigured(true);
        }
        setError(msg);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(filter); }, [filter]);

  const openCount = issues.filter(i => i.state === 'open').length;
  const closedCount = issues.filter(i => i.state === 'closed').length;

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-md border border-border-default p-0.5">
          {(['open', 'closed', 'all'] as FilterState[]).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                filter === s
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {s === 'open' ? 'Open' : s === 'closed' ? 'Closed' : 'All'}
            </button>
          ))}
        </div>
        {filter === 'all' && (
          <div className="flex gap-2 text-xs text-text-muted">
            <span className="text-win">{openCount} open</span>
            <span>/</span>
            <span className="text-text-muted">{closedCount} closed</span>
          </div>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => load(filter)}
          className="h-7 text-text-muted"
        >
          <RefreshCw size={12} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-loss/30 bg-loss/5 px-4 py-3 text-sm text-loss">
          {error === 'Feedback not configured'
            ? 'GitHub integration not configured. Set GITHUB_TOKEN and GITHUB_REPO environment variables.'
            : error}
        </div>
      )}

      {/* Issue list */}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {loading ? (
            <LoadingSprite />
          ) : issues.length === 0 ? (
            <EmptyState
              variant="quiet"
              title={`No ${filter !== 'all' ? filter + ' ' : ''}feedback issues.`}
              spriteSize="md"
              padding="sm"
            />
          ) : (
            issues.map(issue => (
              <IssueRow key={issue.number} issue={issue} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IssueRow({ issue }: { issue: ApiFeedbackIssue }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = issue.state === 'open';

  const ts = new Date(issue.createdAt);
  const isToday = new Date().toDateString() === ts.toDateString();
  const timeStr = isToday
    ? ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ts.toLocaleDateString([], { month: 'short', day: 'numeric' });

  // Parse reporter from body
  const reporterMatch = issue.body?.match(/\*\*Reporter:\*\* (.+)/);
  const reporter = reporterMatch?.[1] ?? null;
  const pageMatch = issue.body?.match(/\*\*Page:\*\* (.+)/);
  const page = pageMatch?.[1] ?? null;

  // Get description (everything before the --- separator)
  const descParts = issue.body?.split('\n---\n');
  const desc = descParts?.[0]?.trim() ?? '';

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-surface-overlay/50 transition-colors text-left"
      >
        {/* State icon */}
        {isOpen ? (
          <CircleDot size={16} className="shrink-0 text-win" />
        ) : (
          <CircleCheck size={16} className="shrink-0 text-text-muted" />
        )}

        {/* Title + number */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{issue.title}</span>
            <span className="text-xs text-text-muted font-mono shrink-0">#{issue.number}</span>
          </div>
          {reporter && (
            <span className="text-xs text-text-muted">{reporter}</span>
          )}
        </div>

        {/* Page badge */}
        {page && (
          <Badge variant="outline" className="shrink-0 text-[10px] border-border-default text-text-muted">
            {page}
          </Badge>
        )}

        {/* Labels */}
        {issue.labels.filter(l => l && l !== 'feedback').map(label => (
          <Badge key={label} variant="outline" className="shrink-0 text-[10px] border-neon/30 text-neon bg-neon/5">
            {label}
          </Badge>
        ))}

        {/* Timestamp */}
        <span className="shrink-0 w-16 text-right text-xs text-text-muted font-mono tabular-nums">
          {timeStr}
        </span>

        {expanded ? <ChevronUp size={14} className="shrink-0 text-text-muted" /> : <ChevronDown size={14} className="shrink-0 text-text-muted" />}
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-3 pt-0 pl-12">
          <div className="rounded-md bg-surface-overlay/50 border border-border-default p-3 text-sm text-text-secondary whitespace-pre-wrap">
            {desc || 'No description'}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-neon hover:underline"
            >
              <ExternalLink size={12} />
              View on GitHub
            </a>
            {issue.closedAt && (
              <span className="text-xs text-text-muted">
                Closed {new Date(issue.closedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
