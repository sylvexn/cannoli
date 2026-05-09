#!/usr/bin/env bun
/**
 * Scrape S10 replay archive from the public Google Site at
 *   https://sites.google.com/view/cdl-season-10-replays/cannoli-draft-league-season-10
 *
 * Each match page on the Google Site embeds the full Pokemon Showdown
 * battle protocol log inline (`<script class="battle-log-data">…</script>`),
 * because the original PS replay objects have since expired from PS's archive.
 *
 * Output: one JSON file per match under
 *   backend/imports/replays/s10/<league>/<phase>/<slug>.json
 *
 * Re-running is idempotent — already-cached files are skipped unless
 * --force is passed.
 *
 * Usage:
 *   bun run scripts/scrape-s10-replays.ts            # scrape missing
 *   bun run scripts/scrape-s10-replays.ts --force    # re-scrape all
 *   bun run scripts/scrape-s10-replays.ts --league=emerald --phase=regular
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = 'https://sites.google.com/view/cdl-season-10-replays/cannoli-draft-league-season-10';
const OUT_DIR = resolve(import.meta.dir, '../imports/replays/s10');
const UA = 'Mozilla/5.0 (cannoli-scraper)';
const CONCURRENCY = 6;

const FORCE = process.argv.includes('--force');
const ONLY_LEAGUE = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
const ONLY_PHASE = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1];

const LEAGUES = ['emerald', 'ruby', 'sapphire'] as const;
type League = (typeof LEAGUES)[number];

interface MatchRecord {
  league: League;
  phase: 'regular' | 'qf' | 'sf' | 'f';
  week?: number;
  matchNumber?: number; // playoff bracket m#
  homeAbbrev: string;
  awayAbbrev: string;
  forfeitSide: 'home' | 'away' | null;
  pageUrl: string;
  replayId: string | null;
  replayUrl: string | null;
  players: { p1: string; p2: string } | null;
  uploadTime: number | null; // unix seconds from |t:| line
  log: string | null;
  scrapedAt: string;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function fetchText(url: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.status === 404) throw new Error(`404 ${url}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.text();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

// ─── Crawling ────────────────────────────────────────────────────────────────

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

async function listMatchSlugs(league: League): Promise<{
  regular: { week: number; slug: string }[];
  playoffs: { round: 'qf' | 'sf' | 'f'; matchNumber: number; slug: string }[];
}> {
  // ── Regular season ──
  const regSeasonHtml = await fetchText(`${ROOT}/${league}-regular-season`);
  const weekHrefRe = new RegExp(
    `${league}-regular-season/(week-(\\d+)[a-z])`,
    'g',
  );
  const weekSlugs = uniq([...regSeasonHtml.matchAll(weekHrefRe)].map((m) => m[1]));

  const regular: { week: number; slug: string }[] = [];
  for (const ws of weekSlugs) {
    const wkNum = parseInt(ws.match(/week-(\d+)/)![1]);
    const wkHtml = await fetchText(`${ROOT}/${league}-regular-season/${ws}`);
    const matchSlugs = uniq(
      [...wkHtml.matchAll(new RegExp(`${ws}/([a-z0-9-]+)`, 'g'))].map((m) => m[1]),
    );
    for (const ms of matchSlugs) {
      regular.push({ week: wkNum, slug: `${league}-regular-season/${ws}/${ms}` });
    }
  }

  // ── Playoffs ──
  const playoffs: { round: 'qf' | 'sf' | 'f'; matchNumber: number; slug: string }[] = [];
  const ROUND_MAP: Record<string, 'qf' | 'sf' | 'f'> = {
    [`${league}-quarterfinals`]: 'qf',
    [`${league}-semifinals`]: 'sf',
    [`${league}-finals`]: 'f',
  };
  for (const [phaseSlug, round] of Object.entries(ROUND_MAP)) {
    const phaseHtml = await fetchText(`${ROOT}/${league}-playoffs/${phaseSlug}`);
    const matchSlugs = uniq(
      [...phaseHtml.matchAll(new RegExp(`${phaseSlug}/(m(\\d+)-[a-z0-9-]+)`, 'g'))].map(
        (m) => m[1],
      ),
    );
    for (const ms of matchSlugs) {
      const num = parseInt(ms.match(/^m(\d+)-/)![1]);
      playoffs.push({ round, matchNumber: num, slug: `${league}-playoffs/${phaseSlug}/${ms}` });
    }
  }

  return { regular, playoffs };
}

// ─── Match page parsing ──────────────────────────────────────────────────────

/**
 * The Google Sites HTML double-encodes the embedded battle-log-data block.
 * Decoding twice gives us the raw `<script class="battle-log-data">…</script>`.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function parseMatchPage(html: string): {
  replayId: string | null;
  log: string | null;
  players: { p1: string; p2: string } | null;
  uploadTime: number | null;
} {
  // Decode twice — Google Sites wraps content inside JS strings.
  const decoded = decodeEntities(decodeEntities(html));

  const idMatch = decoded.match(/name="replayid"\s+value="(gen9[a-z]+-\d+)"/);
  const replayId = idMatch ? idMatch[1] : null;

  const logMatch = decoded.match(
    /<script type="text\/plain" class="battle-log-data">([\s\S]*?)<\/script>/,
  );
  const log = logMatch ? logMatch[1] : null;

  let players: { p1: string; p2: string } | null = null;
  let uploadTime: number | null = null;
  if (log) {
    const p1m = log.match(/^\|player\|p1\|([^|]+)\|/m);
    const p2m = log.match(/^\|player\|p2\|([^|]+)\|/m);
    if (p1m && p2m) players = { p1: p1m[1], p2: p2m[1] };
    const tm = log.match(/^\|t:\|(\d+)/m);
    if (tm) uploadTime = parseInt(tm[1]);
  }

  return { replayId, log, players, uploadTime };
}

// ─── Slug → team-pair parsing ────────────────────────────────────────────────

function parseTeamPair(matchSlug: string): {
  homeAbbrev: string;
  awayAbbrev: string;
  forfeitSide: 'home' | 'away' | null;
} {
  // Strip leading "mN-" for playoffs
  const stripped = matchSlug.replace(/^m\d+-/, '');
  // Split on `-vs-` (only one occurrence per slug)
  const parts = stripped.split('-vs-');
  if (parts.length !== 2) {
    throw new Error(`Cannot parse team pair from slug: ${matchSlug}`);
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function scrapeLeague(league: League) {
  if (ONLY_LEAGUE && ONLY_LEAGUE !== league) return { saved: 0, skipped: 0, errors: 0 };
  console.log(`\n── ${league.toUpperCase()} ──`);

  const { regular, playoffs } = await listMatchSlugs(league);
  console.log(`  Found ${regular.length} regular + ${playoffs.length} playoff match pages`);

  type Item = {
    league: League;
    phase: 'regular' | 'qf' | 'sf' | 'f';
    week?: number;
    matchNumber?: number;
    fullSlug: string;
  };

  const items: Item[] = [
    ...regular.map((r) => ({
      league,
      phase: 'regular' as const,
      week: r.week,
      fullSlug: r.slug,
    })),
    ...playoffs.map((p) => ({
      league,
      phase: p.round,
      matchNumber: p.matchNumber,
      fullSlug: p.slug,
    })),
  ];

  const filtered = ONLY_PHASE ? items.filter((it) => it.phase === ONLY_PHASE) : items;

  let saved = 0,
    skipped = 0,
    errors = 0;

  await pool(filtered, CONCURRENCY, async (it) => {
    const matchPart = it.fullSlug.split('/').pop()!;
    const phaseDir = it.phase === 'regular' ? `regular/week-${it.week}` : `playoffs/${it.phase}`;
    const outFile = resolve(OUT_DIR, league, phaseDir, `${matchPart}.json`);

    if (!FORCE && existsSync(outFile)) {
      skipped++;
      return;
    }

    try {
      const url = `${ROOT}/${it.fullSlug}`;
      const html = await fetchText(url);
      const { replayId, log, players, uploadTime } = parseMatchPage(html);
      const { homeAbbrev, awayAbbrev, forfeitSide } = parseTeamPair(matchPart);

      const record: MatchRecord = {
        league,
        phase: it.phase,
        week: it.week,
        matchNumber: it.matchNumber,
        homeAbbrev,
        awayAbbrev,
        forfeitSide,
        pageUrl: url,
        replayId,
        replayUrl: replayId ? `https://replay.pokemonshowdown.com/${replayId}` : null,
        players,
        uploadTime,
        log,
        scrapedAt: new Date().toISOString(),
      };

      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, JSON.stringify(record, null, 2));
      saved++;
      const flag = !replayId ? '(no replay)' : !log ? '(no log)' : '';
      console.log(`  ${homeAbbrev} vs ${awayAbbrev} [${it.phase}${it.week ? ` w${it.week}` : ''}] ${flag}`);
    } catch (e) {
      errors++;
      console.error(`  ERROR ${it.fullSlug}: ${(e as Error).message}`);
    }
  });

  return { saved, skipped, errors };
}

const totals = { saved: 0, skipped: 0, errors: 0 };
for (const league of LEAGUES) {
  const r = await scrapeLeague(league);
  totals.saved += r.saved;
  totals.skipped += r.skipped;
  totals.errors += r.errors;
}

console.log(`\n✓ Done. Saved ${totals.saved}, skipped ${totals.skipped}, errors ${totals.errors}`);
console.log(`  Cache: ${OUT_DIR}`);
