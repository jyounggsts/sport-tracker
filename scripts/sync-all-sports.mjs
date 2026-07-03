#!/usr/bin/env node
/**
 * Syncs ESPN scoreboard + standings and FIFA World Cup data into data/ and docs/data/.
 * Detects off-season status and caches previous-season standings.
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

function detectSeasonStatus(standings, scoreboard) {
  const now = Date.now();
  const seasons = standings?.seasons || [];
  const year = scoreboard?.season?.year ?? seasons[0]?.year ?? null;
  const seasonDef = seasons.find((s) => s.year === year) ?? seasons[0];

  if (!seasonDef) {
    const events = scoreboard?.events || [];
    const hasActive = events.some((e) => {
      if (e.status?.type?.state === 'in') return true;
      const diff = (new Date(e.date).getTime() - now) / 86_400_000;
      return diff >= -1 && diff <= 14;
    });
    return {
      inSeason: hasActive,
      seasonYear: year,
      previousSeasonYear: year ? year - 1 : null,
      previousSeasonDisplay: year ? String(year - 1) : null,
      returnsDate: null,
    };
  }

  const off = seasonDef.types?.find((t) => t.abbreviation === 'off');
  if (off) {
    const start = new Date(off.startDate).getTime();
    const end = new Date(off.endDate).getTime();
    if (now >= start && now <= end) {
      const prev = seasons.find((s) => s.year < seasonDef.year);
      return {
        inSeason: false,
        seasonYear: seasonDef.year,
        previousSeasonYear: prev?.year ?? seasonDef.year - 1,
        previousSeasonDisplay: prev?.displayName ?? String(prev?.year ?? seasonDef.year - 1),
        returnsDate: off.endDate,
      };
    }
  }

  return {
    inSeason: true,
    seasonYear: seasonDef.year,
    previousSeasonYear: null,
    previousSeasonDisplay: null,
    returnsDate: null,
  };
}

async function syncEspnSport({ id, category, league }) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${category}/${league}`;
  const standingsBase = `https://site.api.espn.com/apis/v2/sports/${category}/${league}`;

  const [scoreboard, standings] = await Promise.all([
    fetchJSON(`${base}/scoreboard`).catch((err) => ({ error: err.message, events: [] })),
    fetchJSON(`${standingsBase}/standings`).catch((err) => ({ error: err.message, children: [], seasons: [] })),
  ]);

  const seasonStatus = detectSeasonStatus(standings, scoreboard);
  let standingsPrev = null;

  if (!seasonStatus.inSeason && seasonStatus.previousSeasonYear) {
    standingsPrev = await fetchJSON(`${standingsBase}/standings?season=${seasonStatus.previousSeasonYear}`)
      .catch((err) => ({ error: err.message, children: [] }));
  }

  const liveCount = (scoreboard.events || []).filter((e) => e.status?.type?.state === 'in').length;

  await writeJSON(`${id}/scoreboard.json`, {
    fetchedAt: new Date().toISOString(),
    sportId: id,
    liveCount,
    seasonStatus,
    ...scoreboard,
  });

  await writeJSON(`${id}/standings.json`, {
    fetchedAt: new Date().toISOString(),
    sportId: id,
    seasonStatus,
    ...standings,
  });

  if (standingsPrev) {
    await writeJSON(`${id}/standings-prev.json`, {
      fetchedAt: new Date().toISOString(),
      sportId: id,
      seasonStatus,
      seasonYear: seasonStatus.previousSeasonYear,
      ...standingsPrev,
    });
  }

  const status = seasonStatus.inSeason ? 'in-season' : `off-season (${seasonStatus.previousSeasonDisplay})`;
  console.log(`${id}: ${scoreboard.events?.length ?? 0} events, ${liveCount} live, ${status}`);
  return { id, events: scoreboard.events?.length ?? 0, liveCount, inSeason: seasonStatus.inSeason };
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

  const { execSync } = await import('node:child_process');
  try {
    execSync('node scripts/sync-youtube-live.mjs', { cwd: ROOT, stdio: 'inherit' });
    execSync('node scripts/sync-goal-clips.mjs', { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.warn('fifa extras sync warning:', err.message);
  }

  const games = await fetchJSON(`${FIFA_API}/games`);
  const gameList = games.games || [];
  const liveCount = gameList.filter((g) => {
    const elapsed = String(g.time_elapsed || '').toLowerCase();
    return !['finished', 'ft', ''].includes(elapsed) && g.finished !== 'TRUE';
  }).length;
  const remaining = gameList.filter((g) => g.finished !== 'TRUE').length;
  const inSeason = remaining > 0;

  const seasonStatus = {
    inSeason,
    seasonYear: 2026,
    previousSeasonDisplay: inSeason ? null : '2022',
    returnsDate: inSeason ? null : '2026-06-11',
    label: inSeason ? 'Tournament Active' : 'Out of Season',
  };

  for (const path of [`fifa/season.json`]) {
    await writeJSON(path, { fetchedAt: new Date().toISOString(), sportId: 'fifa', seasonStatus });
  }

  console.log(`fifa: ${gameList.length} games, ${liveCount} live, ${inSeason ? 'in-season' : 'off-season'}`);
  return { id: 'fifa', events: gameList.length, liveCount, inSeason };
}

async function updateManifest(summaries) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  manifest.updatedAt = new Date().toISOString();
  manifest.liveSummary = Object.fromEntries(summaries.map((s) => [s.id, s.liveCount]));
  manifest.seasonSummary = Object.fromEntries(summaries.map((s) => [s.id, s.inSeason]));
  await writeJSON('manifest.json', manifest);
}

const summaries = [];
for (const sport of ESPN_SPORTS) {
  summaries.push(await syncEspnSport(sport));
}
summaries.push(await syncFifa());
await updateManifest(summaries);
console.log('Sync complete:', summaries.map((s) => `${s.id}=${s.inSeason ? 'live' : 'off'}`).join(', '));