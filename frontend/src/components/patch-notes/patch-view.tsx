import { Link as LinkIcon } from 'lucide-react';
import type { ApiPatchNote, ApiPatch } from '@/lib/api';
import { PATCH_SECTION_META, PATCH_SECTION_ORDER } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Sections of one patch/hotfix; empty kinds are skipped. */
export function PatchSections({ sections }: { sections: ApiPatchNote['sections'] }) {
  const byKind = new Map(sections.map(s => [s.kind, s.items]));
  return (
    <div className="space-y-4">
      {PATCH_SECTION_ORDER.filter(k => byKind.get(k)?.length).map(kind => {
        const meta = PATCH_SECTION_META[kind];
        return (
          <section key={kind}>
            <h3
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: meta.color }}
            >
              <meta.Icon size={12} className="shrink-0" />
              {meta.label}
            </h3>
            <ul className="space-y-1.5">
              {byKind.get(kind)!.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="min-w-0 whitespace-pre-line">{item}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One patch card: hero, version/date/title, sections, nested hotfixes. */
export function PatchView({
  patch, isNew = false, draft = false,
}: { patch: ApiPatch | (ApiPatchNote & { hotfixes?: ApiPatchNote[] }); isNew?: boolean; draft?: boolean }) {
  const hotfixes = patch.hotfixes ?? [];
  return (
    <article
      id={`v${patch.version ?? patch.id}`}
      className={cn(
        'rounded-lg border bg-surface-raised overflow-hidden scroll-mt-4',
        isNew ? 'border-neon/40' : 'border-border-default',
      )}
    >
      {patch.heroUrl && (
        <img src={patch.heroUrl} alt="" loading="lazy" className="w-full max-h-64 object-cover" />
      )}
      <div className="p-4 sm:p-5 space-y-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {patch.version && (
            <span className="font-mono text-sm font-bold text-neon">v{patch.version}</span>
          )}
          <h2 className="min-w-0 text-lg font-semibold text-text-primary">{patch.title}</h2>
          {isNew && (
            <span className="rounded-full bg-neon/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neon">New</span>
          )}
          {draft && (
            <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-400">Draft</span>
          )}
          <time className="ml-auto text-xs text-text-muted tabular-nums" dateTime={patch.date}>
            {formatDate(patch.date)}
          </time>
        </header>

        <PatchSections sections={patch.sections} />

        {hotfixes.length > 0 && (
          <div className="space-y-2 border-t border-border-default pt-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Hotfixes</div>
            {hotfixes.map(h => (
              <details key={h.id} id={`v${h.version ?? h.id}`} className="group rounded-md border border-border-default/60 bg-surface-overlay/30 scroll-mt-4">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm outline-none focus-visible:bg-surface-overlay/60">
                  {h.version && <span className="font-mono text-xs font-bold text-amber-400">v{h.version}</span>}
                  <span className="min-w-0 truncate text-text-primary">{h.title}</span>
                  <time className="ml-auto shrink-0 text-[11px] text-text-muted tabular-nums">{formatDate(h.date)}</time>
                </summary>
                <div className="px-3 pb-3 pt-1"><PatchSections sections={h.sections} /></div>
              </details>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export function PatchAnchor({ version }: { version: string }) {
  return (
    <a
      href={`#v${version}`}
      className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 font-mono text-[11px] text-text-secondary hover:border-neon/40 hover:text-neon transition-colors"
    >
      <LinkIcon size={10} />v{version}
    </a>
  );
}
