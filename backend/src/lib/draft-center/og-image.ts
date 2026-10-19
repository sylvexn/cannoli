/**
 * Share-card image (1200x630 PNG) for shared Draft Center teams: sprite grid +
 * team name + coach display name in their team color. Used as `og:image` so a
 * pasted link unfurls in Discord.
 *
 * Rendered as an SVG by @resvg/resvg-wasm (pure WASM, no native binary — the
 * backend image is a plain bun base). Sprites are fetched from the Showdown
 * sprite CDN once and cached in memory; a failed fetch degrades to a blank tile
 * rather than failing the card. Rendered PNGs are cached per (token, updatedAt).
 */

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { resolve } from 'path';
import { toSpriteId } from './sprite-id';
import type { DcMon } from './types';

export interface OgCard {
  teamName: string;
  coachName: string;
  coachColor: string | null;
  subtitle: string;
  roster: DcMon[];
}

const FONT_PATH = resolve(import.meta.dir, '../../assets/og-mono-bold.otf');
const WASM_PATH = Bun.resolveSync('@resvg/resvg-wasm/index_bg.wasm', import.meta.dir);

let ready: Promise<void> | null = null;
let fontBuf: Uint8Array | null = null;

async function init(): Promise<void> {
  ready ??= (async () => {
    await initWasm(await Bun.file(WASM_PATH).arrayBuffer());
    fontBuf = new Uint8Array(await Bun.file(FONT_PATH).arrayBuffer());
  })().catch(err => { ready = null; throw err; });
  return ready;
}

const spriteCache = new Map<string, string | null>();

async function spriteDataUri(name: string): Promise<string | null> {
  const id = toSpriteId(name);
  if (spriteCache.has(id)) return spriteCache.get(id)!;
  let uri: string | null = null;
  try {
    const res = await fetch(`https://play.pokemonshowdown.com/sprites/gen5/${id}.png`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) uri = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch { /* offline / CDN hiccup — render a blank tile */ }
  // Only cache hits; a transient failure should be retried next render.
  if (uri) spriteCache.set(id, uri);
  return uri;
}

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const HEX = /^#[0-9a-fA-F]{6}$/;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function buildCardSvg(card: OgCard): Promise<string> {
  const accent = card.coachColor && HEX.test(card.coachColor) ? card.coachColor : '#7dd3fc';
  const mons = card.roster.slice(0, 12);
  const sprites = await Promise.all(mons.map(m => spriteDataUri(m.name)));

  const rows = mons.length > 6 ? 2 : 1;
  const cols = Math.max(1, Math.ceil(mons.length / rows));
  const tile = Math.min(170, Math.floor(1080 / cols));
  const gridW = cols * tile;
  const x0 = Math.round((1200 - gridW) / 2);
  const y0 = rows === 2 ? 232 + Math.round((170 - tile) / 2) : 330;

  const tiles = mons.map((m, i) => {
    const x = x0 + (i % cols) * tile;
    const y = y0 + Math.floor(i / cols) * tile;
    const img = sprites[i];
    const border = m.captain ? '#f95587' : '#ffffff22';
    return `<rect x="${x + 4}" y="${y + 4}" width="${tile - 8}" height="${tile - 8}" rx="14" fill="#ffffff0a" stroke="${border}" stroke-width="${m.captain ? 3 : 1.5}"/>`
      + (img ? `<image href="${img}" x="${x + 10}" y="${y + 10}" width="${tile - 20}" height="${tile - 20}" image-rendering="optimizeSpeed"/>` : '')
      + (m.captain ? `<circle cx="${x + tile - 20}" cy="${y + 20}" r="12" fill="#f95587"/><text x="${x + tile - 20}" y="${y + 25}" font-size="14" text-anchor="middle" fill="#fff" font-family="Berkeley Mono, monospace">T</text>` : '');
  }).join('');

  const nameSize = card.teamName.length > 22 ? 52 : 68;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#151a2e"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<rect x="0" y="0" width="1200" height="8" fill="${accent}"/>
<text x="60" y="68" font-size="22" fill="#94a3b8" letter-spacing="6" font-family="Berkeley Mono, monospace">DRAFT CENTER</text>
<text x="60" y="150" font-size="${nameSize}" fill="#f8fafc" font-family="Berkeley Mono, monospace">${xmlEscape(clip(card.teamName, 30))}</text>
<text x="60" y="198" font-size="30" fill="${accent}" font-family="Berkeley Mono, monospace">${xmlEscape(clip(card.coachName, 32))}</text>
<text x="1140" y="68" font-size="22" fill="#94a3b8" text-anchor="end" font-family="Berkeley Mono, monospace">${xmlEscape(clip(card.subtitle, 50))}</text>
${tiles}
<text x="600" y="618" font-size="16" fill="#475569" text-anchor="middle" font-family="Berkeley Mono, monospace">cannoli.live</text>
</svg>`;
}

export async function renderCardPng(card: OgCard): Promise<Uint8Array> {
  await init();
  const svg = await buildCardSvg(card);
  const resvg = new Resvg(svg, {
    font: { fontBuffers: [fontBuf!], defaultFontFamily: 'Berkeley Mono', loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

// Rendered-card cache: key = token + updatedAt, so an edit naturally busts it.
const pngCache = new Map<string, Uint8Array>();
const PNG_CACHE_MAX = 200;

export async function cachedCardPng(key: string, card: OgCard): Promise<Uint8Array> {
  const hit = pngCache.get(key);
  if (hit) return hit;
  const png = await renderCardPng(card);
  if (pngCache.size >= PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value!);
  pngCache.set(key, png);
  return png;
}
