#!/usr/bin/env node
/**
 * Syncs ESPN scoreboard + standings and FIFA World Cup data into data/ and docs/data/.
 * Runs in GitHub Actions (no browser CORS limits).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const DOCS_DATA_DIR = join(ROOT, 'docs', 'data');
const MANIFEST_PATH = join(DATA_DIR, 'manifest.json');
const FIFA_API = 'https://worldcup26.ir/get';

const ESPN_SPORTS = [
  { id: 'nfl', category: 'football', league: 'nfl' },
  { id: 'nba', category: 'basketball', league: 'nba' },
  { id: 'mlb', category: 'baseball', league: 'mlb' },
  { id: 'nhl', category: 'hockey', league: 'nhl' },
  { id: 'mls', category: 'soccer', league: 'usa.1' },
  { id: 'ncaaf', category: 'football', league: 'college-football' },
  { id: 'wnba', category: 'basketball', league: 'wnba' },
];

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sport-tracker-sync/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function writeJSON(relativePath, payload) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  for (const base of [DATA_DIR, DOCS_DATA_DIR]) {
    const path = join(base, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, json, 'utf8');
  }
}

async function syncEspnSport({ id, category, league }) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${category}/${league}`;
  const standingsBase = `https://site.api.espn.com/apis/v2/sports/${category}/${league}`;

  const [scoreboard, standings] = await Promise.all([
    fetchJSON(`${base}/scoreboard`).catch((err) => ({ error: err.message, events: [] })),
    fetchJSON(`${standingsBase}/standings`).catch((err) => ({ error: err.message, children: [] })),
  ]);

  const liveCount = (scoreboard.events || []).filter((e) => e.status?.type?.state === 'in').length;

  await writeJSON(`${id}/scoreboard.json`, {
    fetchedAt: new Date().toISOString(),
    sportId: id,
    liveCount,
    ...scoreboard,
  });

  await writeJSON(`${id}/standings.json`, {
    fetchedAt: new Date().toISOString(),
    sportId: id,
    ...standings,
  });

  console.log(`${id}: ${scoreboard.events?.length ?? 0} events, ${liveCount} live`);
  return { id, events: scoreboard.events?.length ?? 0, liveCount };
}

async function syncFifa() {
  for (const endpoint of ['teams', 'groups', 'games']) {
    const data = await fetchJSON(`${FIFA_API}/${endpoint}`);
    await writeJSON(`fifa/${endpoint}.json`, {
      fetchedAt: new Date().toISOString(),
      sportId: 'fifa',
      ...data,
    });
  }

  const games = await fetchJSON(`${FIFA_API}/games`);
  const liveCount = (games.games || []).filter((g) => {
    const elapsed = String(g.time_elapsed || '').toLowerCase();
    return !['finished', 'ft', ''].includes(elapsed) && g.finished !== 'TRUE';
  }).length;

  console.log(`fifa: ${games.games?.length ?? 0} games, ${liveCount} live`);
  return { id: 'fifa', events: games.games?.length ?? 0, liveCount };
}

async function updateManifest(summaries) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  manifest.updatedAt = new Date().toISOString();
  manifest.liveSummary = Object.fromEntries(summaries.map((s) => [s.id, s.liveCount]));
  await writeJSON('manifest.json', manifest);
}

const summaries = [];
for (const sport of ESPN_SPORTS) {
  summaries.push(await syncEspnSport(sport));
}
summaries.push(await syncFifa());
await updateManifest(summaries);
console.log('Sync complete:', summaries.map((s) => `${s.id}=${s.liveCount}live`).join(', '));