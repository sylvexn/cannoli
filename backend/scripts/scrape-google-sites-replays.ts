#!/usr/bin/env bun
/**
 * Scrape Pokemon Showdown replays linked from arbitrary Google Sites pages.
 *
 * Companion to scrape-s10-replays.ts: that script crawls a single, well-known
 * Google Site that embeds the full battle-log inline. THIS script handles the
 * other common shape — Google Sites match pages that just embed PS replays
 * (via <iframe>, <a>, or plain URL text), where the actual log lives back on
 * replay.pokemonshowdown.com.
 *
 * Output mirrors scrape-s10-replays.ts so the same import-replays.ts pipeline
 * picks the records up: one JSON file per replay under
 *   backend/imports/replays/s10/<league>/<phase>/<filename>.json
 * with the same MatchRecord shape (league, phase, week|matchNumber,
 * homeAbbrev, awayAbbrev, replayId, replayUrl, log, ...).
 *
 * ─── URL list format ────────────────────────────────────────────────────────
 * One entry per line in `backend/imports/replays/google-sites-urls.txt`.
 * Three accepted shapes (fields are tab- OR comma-separated):
 *
 *   <url>
 *     Plain URL. Falls back to <league=_unsorted>/<phase=misc>/<auto-slug>;
 *     you'll need to move + rename the resulting file before the importer
 *     can match it to a `matches` row.
 *
 *   <league>\t<phase>\t<slug>\t<url>
 *     Fully specified. `phase` is one of:
 *       regular/week-N   playoffs/qf   playoffs/sf   playoffs/f
 *     `slug` becomes the JSON filename and (when parseable as `home-vs-away`)
 *     also seeds the homeAbbrev/awayAbbrev fields. Tab-separated; comma works
 *     too if the slug doesn't contain commas.
 *
 *   # comment line — ignored.
 *
 * ─── Output JSON shape ──────────────────────────────────────────────────────
 * Same MatchRecord shape as scrape-s10-replays.ts, so import-replays.ts
 * already knows how to wire it into the matches table.
 *
 * ─── Usage ──────────────────────────────────────────────────────────────────
 *   bun run scripts/scrape-google-sites-replays.ts          # scrape missing
 *   bun run scripts/scrape-google-sites-replays.ts --force  # re-fetch all
 *
 * Then re-run the regular replay import to pick up the new JSON:
 *   bun run scripts/import-replays.ts
 *
 * Failed URLs are logged to stderr; rerun is idempotent.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// ─── Paths ──────────────────────────────────────────────────────────────────

const URL_LIST = resolve(import.meta.dir, '../imports/replays/google-sites-urls.txt');
const OUT_ROOT = resolve(import.meta.dir, '../imports/replays/s10');
const UA = 'Mozilla/5.0 (cannoli-scraper)';
const CONCURRENCY = 4;

const FORCE = process.argv.includes('--force');

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase = 'regular' | 'qf' | 'sf' | 'f';
type League = 'sapphire' | 'ruby' | 'emerald' | '_unsorted';

interface UrlEntry {
  url: string;
  league: League;
  phase: Phase | 'misc';
  week?: number;
  slug: string;
}

interface MatchRecord {
  league: League;
  phase: Phase | 'misc';
  week?: number;
  matchNumber?: number;
  homeAbbrev: string;
  awayAbbrev: string;
  forfeitSide: 'home' | 'away' | null;
  pageUrl: string;
  replayId: string | null;
  replayUrl: string | null;
  players: { p1: string; p2: string } | null;
  uploadTime: number | null;
  log: string | null;
  scrapedAt: string;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function fetchText(url: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

// ─── URL list parsing ────────────────────────────────────────────────────────

const VALID_LEAGUES: League[] = ['sapphire', 'ruby', 'emerald'];

function parsePhaseSpec(raw: string): { phase: Phase | 'misc'; week?: number } {
  const s = raw.trim().toLowerCase();
  if (s.startsWith('regular/week-')) {
    const week = parseInt(s.slice('regular/week-'.length));
    return { phase: 'regular', week: Number.isFinite(week) ? week : undefined };
  }
  if (s === 'regular') return { phase: 'regular' };
  if (s === 'playoffs/qf' || s === 'qf') return { phase: 'qf' };
  if (s === 'playoffs/sf' || s === 'sf') return { phase: 'sf' };
  if (s === 'playoffs/f' || s === 'playoffs/finals' || s === 'f') return { phase: 'f' };
  return { phase: 'misc' };
}

function autoSlugFromUrl(url: string): string {
  const u = url.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return u.slice(-80) || `replay-${Date.now()}`;
}

function parseUrlList(text: string): UrlEntry[] {
  const entries: UrlEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Try tab-separated first; fall back to comma if no tabs present.
    const fields = line.includes('\t') ? line.split('\t') : line.split(',');
    const cleaned = fields.map((f) => f.trim()).filter((f) => f.length > 0);

    if (cleaned.length === 1) {
      const url = cleaned[0];
      entries.push({
        url,
        league: '_unsorted',
        phase: 'misc',
        slug: autoSlugFromUrl(url),
      });
      continue;
    }

    if (cleaned.length >= 4) {
      const [leagueRaw, phaseRaw, slug, url] = cleaned;
      const league = VALID_LEAGUES.find((l) => l === leagueRaw.toLowerCase()) ?? '_unsorted';
      const { phase, week } = parsePhaseSpec(phaseRaw);
      entries.push({ url, league, phase, week, slug });
      continue;
    }

    // 2 or 3 fields — ambiguous; treat last field as URL, dump under _unsorted.
    const url = cleaned[cleaned.length - 1];
    entries.push({
      url,
      league: '_unsorted',
      phase: 'misc',
      slug: cleaned[0] || autoSlugFromUrl(url),
    });
  }
  return entries;
}

// ─── HTML inspection ────────────────────────────────────────────────────────

/** Decode the entity layers Google Sites wraps embedded HTML in. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Pull every Pokemon Showdown replay ID we can find on a Google Sites page.
 * Google embeds replays in several ways depending on how the page was built:
 *   - <iframe src="https://replay.pokemonshowdown.com/<id>">
 *   - <a href="https://replay.pokemonshowdown.com/<id>">
 *   - data-iframe-src / data-cast-iframe-src attributes pointing at PS
 *   - bare URL text in a "view replay" caption
 * Decoding twice handles Google's double-entity wrap on embedded blocks.
 */
function extractReplayIds(html: string): string[] {
  const decoded = decodeEntities(decodeEntities(html));
  const ids = new Set<string>();
  // Match both legacy and current PS replay ID shapes:
  //   gen9natdexdraft-2026...   (S10-style)
  //   gen9-2026...              (older format)
  const re = /replay\.pokemonshowdown\.com\/(?:[a-z]+\/)?([a-z0-9-]+?-\d+(?:-pw[a-z0-9]+)?)/gi;
  for (const m of decoded.matchAll(re)) {
    const id = m[1];
    // Filter obvious non-IDs (e.g. an asset path swallowed by the regex).
    if (id.length < 5) continue;
    ids.add(id);
  }
  return [...ids];
}

// ─── PS replay JSON fetch ────────────────────────────────────────────────────

interface PsReplay {
  id: string;
  format?: string;
  players?: string[];
  log?: string;
  uploadtime?: number;
}

async function fetchPsReplay(replayId: string): Promise<PsReplay> {
  // PS exposes a JSON endpoint at <id>.json with the full protocol log.
  const url = `https://replay.pokemonshowdown.com/${replayId}.json`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`PS replay fetch failed: HTTP ${r.status} ${url}`);
  return (await r.json()) as PsReplay;
}

// ─── Slug -> abbrev pair (best effort) ───────────────────────────────────────

function parseTeamPair(slug: string): {
  homeAbbrev: string;
  awayAbbrev: string;
  forfeitSide: 'home' | 'away' | null;
} {
  const stripped = slug.replace(/^m\d+-/, '');
  const parts = stripped.split('-vs-');
  if (parts.length !== 2) {
    return { homeAbbrev: '', awayAbbrev: '', forfeitSide: null };
  }
  let [home, away] = parts;
  let forfeitSide: 'home' | 'away' | null = null;
  if (home.endsWith('-ff')) {
    forfeitSide = 'home';
    home = home.slice(0, -3);
  } else if (away.endsWith('-ff')) {
    forfeitSide = 'away';
    away = away.slice(0, -3);
  }
  return { homeAbbrev: home, awayAbbrev: away, forfeitSide };
}

// ─── Worker pool ─────────────────────────────────────────────────────────────

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// ─── Output path ─────────────────────────────────────────────────────────────

function outFileFor(entry: UrlEntry, suffix: string): string {
  const phaseDir =
    entry.phase === 'regular' && entry.week !== undefined
      ? `regular/week-${entry.week}`
      : entry.phase === 'qf' || entry.phase === 'sf' || entry.phase === 'f'
      ? `playoffs/${entry.phase}`
      : 'misc';
  // suffix lets us disambiguate when one Google Sites page links multiple
  // replay IDs (rare, but happens when a coach posts the rematch on the
  // same page).
  const filename = suffix ? `${entry.slug}-${suffix}.json` : `${entry.slug}.json`;
  return resolve(OUT_ROOT, entry.league, phaseDir, filename);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(URL_LIST)) {
    console.error(`URL list not found: ${URL_LIST}`);
    console.error('Create it with one URL per line (see header comment for format).');
    process.exit(1);
  }

  const text = readFileSync(URL_LIST, 'utf-8');
  const entries = parseUrlList(text);
  console.log(`Loaded ${entries.length} URL entries from ${URL_LIST}`);

  let saved = 0;
  let skipped = 0;
  let errors = 0;
  const failed: { url: string; reason: string }[] = [];

  await pool(entries, CONCURRENCY, async (entry) => {
    // Quick skip if the canonical (no-suffix) output already exists and we
    // aren't forcing. We can't be sure of the suffix until we fetch, but
    // most pages embed exactly one replay so the canonical path catches the
    // common case cheaply.
    const cheapSkipPath = outFileFor(entry, '');
    if (!FORCE && existsSync(cheapSkipPath)) {
      skipped++;
      return;
    }

    let html: string;
    try {
      html = await fetchText(entry.url);
    } catch (e) {
      errors++;
      const reason = (e as Error).message;
      failed.push({ url: entry.url, reason });
      console.error(`  page-fetch FAILED ${entry.url}: ${reason}`);
      return;
    }

    const ids = extractReplayIds(html);
    if (ids.length === 0) {
      errors++;
      const reason = 'no replay ID found on page';
      failed.push({ url: entry.url, reason });
      console.error(`  no-replay ${entry.url}: ${reason}`);
      return;
    }

    const { homeAbbrev, awayAbbrev, forfeitSide } = parseTeamPair(entry.slug);

    for (let i = 0; i < ids.length; i++) {
      const replayId = ids[i];
      const suffix = ids.length > 1 ? String(i + 1) : '';
      const outPath = outFileFor(entry, suffix);

      if (!FORCE && existsSync(outPath)) {
        skipped++;
        continue;
      }

      try {
        const ps = await fetchPsReplay(replayId);
        const log = ps.log ?? null;
        const players = ps.players && ps.players.length >= 2
          ? { p1: ps.players[0], p2: ps.players[1] }
          : null;
        const record: MatchRecord = {
          league: entry.league,
          phase: entry.phase,
          week: entry.week,
          homeAbbrev,
          awayAbbrev,
          forfeitSide,
          pageUrl: entry.url,
          replayId,
          replayUrl: `https://replay.pokemonshowdown.com/${replayId}`,
          players,
          uploadTime: ps.uploadtime ?? null,
          log,
          scrapedAt: new Date().toISOString(),
        };

        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, JSON.stringify(record, null, 2));
        saved++;
        console.log(`  saved ${entry.league}/${entry.phase}${entry.week ? '-w' + entry.week : ''}/${entry.slug}${suffix ? '-' + suffix : ''}`);
      } catch (e) {
        errors++;
        const reason = (e as Error).message;
        failed.push({ url: `${entry.url} → ${replayId}`, reason });
        console.error(`  replay-fetch FAILED ${replayId} (from ${entry.url}): ${reason}`);
      }
    }
  });

  console.log(`\nDone. Saved ${saved}, skipped ${skipped}, errors ${errors}`);
  console.log(`  Cache: ${OUT_ROOT}`);
  if (failed.length > 0) {
    console.error(`\n${failed.length} URL(s) failed; re-run after fixing the source pages or rerun with --force:`);
    for (const f of failed) console.error(`  - ${f.url}  (${f.reason})`);
  }
  console.log('\nNext: bun run scripts/import-replays.ts to wire the JSON into the matches table.');
}

await main();
