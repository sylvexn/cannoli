import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TIER_LIST } from '@/data/tier-list';
import { MOVE_TYPES } from '@/data/move-types';
import { TYPE_COLORS } from '@/lib/constants';
import { pokemonRoute } from '@/lib/pokemon-route';

/**
 * Turns a PS battle-log line (sanitized HTML string from the embed bridge)
 * into rich React: Pokemon species names become links to /pokemon/:name, move
 * names get tinted by their type, and the line carries a tone (faint / super
 * effective / resisted / immune / crit) for line-level coloring.
 *
 * Why parse instead of dangerouslySetInnerHTML: we want real react-router
 * <Link>s (SPA nav, no reload) and per-token styling. PS marks moves and
 * switched-in species in <strong>; the acting Pokemon is plain text. Matching
 * plain text against the known dex links real species and naturally skips
 * nicknames (which aren't in the dex).
 */

export type LineTone = 'normal' | 'faint' | 'super' | 'resist' | 'immune' | 'crit';

export interface RenderedLine {
  /** Original PS line classes (battle-history / chat / spacer) — drives base CSS. */
  className: string;
  tone: LineTone;
  nodes: ReactNode;
}

// Precompiled species matcher: every dex name, longest-first (so "Iron
// Valiant" wins over "Iron"), regex-escaped, bounded by non-alphanumerics so
// only whole names match.
let _speciesRe: RegExp | null = null;
function speciesRegex(): RegExp {
  if (_speciesRe) return _speciesRe;
  const names = TIER_LIST.map(e => e.name).filter(Boolean).sort((a, b) => b.length - a.length);
  const alt = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  _speciesRe = new RegExp(`(?<![A-Za-z0-9])(?:${alt})(?![A-Za-z0-9])`, 'g');
  return _speciesRe;
}

// Monotonic key source — keys only need to be unique among siblings, and a
// rendered line is memoized so this runs once per line.
let _key = 0;

function linkifySpecies(text: string): ReactNode {
  if (!text) return text;
  const re = speciesRegex();
  re.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[0];
    out.push(
      <Link
        key={`s${_key++}`}
        to={pokemonRoute(name)}
        onClick={e => e.stopPropagation()}
        className="replay-mon-link"
      >
        {name}
      </Link>,
    );
    last = m.index + name.length;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length === 0 ? text : out.length === 1 ? out[0] : out;
}

function nodeToReact(node: ChildNode): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return linkifySpecies(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  const key = `e${_key++}`;
  switch (el.tagName) {
    case 'BR':
      return <br key={key} />;
    case 'STRONG': {
      const moveType = MOVE_TYPES[el.textContent || ''];
      // A <strong> is either a move (color by type) or a switched-in species
      // (linkify its contents). Move and species name sets don't overlap.
      if (moveType) return <strong key={key} style={{ color: TYPE_COLORS[moveType] }}>{el.textContent}</strong>;
      return <strong key={key}>{childrenToReact(el)}</strong>;
    }
    case 'EM':
      return <em key={key}>{childrenToReact(el)}</em>;
    case 'SMALL':
      return <small key={key}>{childrenToReact(el)}</small>;
    default:
      return <span key={key}>{childrenToReact(el)}</span>;
  }
}

function childrenToReact(el: Element): ReactNode[] {
  const out: ReactNode[] = [];
  el.childNodes.forEach(c => {
    const r = nodeToReact(c);
    if (r !== null && r !== undefined) out.push(r);
  });
  return out;
}

function classifyTone(text: string): LineTone {
  if (/fainted!/.test(text)) return 'faint';
  if (/super effective/i.test(text)) return 'super';
  if (/not very effective/i.test(text)) return 'resist';
  if (/had no effect|doesn.t affect|is immune/i.test(text)) return 'immune';
  if (/critical hit/i.test(text)) return 'crit';
  return 'normal';
}

export function renderLogLine(html: string): RenderedLine {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return { className: '', tone: 'normal', nodes: html };
  return {
    className: root.getAttribute('class') || '',
    tone: classifyTone(root.textContent || ''),
    nodes: childrenToReact(root),
  };
}
