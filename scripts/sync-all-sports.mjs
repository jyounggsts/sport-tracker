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

function getScoreboardSeasonYear(scoreboard, fallback) {
  return scoreboard?.season?.year
    ?? scoreboard?.leagues?.[0]?.season?.year
    ?? fallback
    ?? null;
}

function getCompletedSeason(seasons, seasonDef, scoreboardYear) {
  if (scoreboardYear > seasonDef.year) return seasonDef;
  return seasons.find((s) => s.year < seasonDef.year) ?? seasonDef;
}

function detectSeasonStatus(standings, scoreboard) {
  const now = Date.now();
  const seasons = standings?.seasons || [];
  const year = getScoreboardSeasonYear(scoreboard, seasons[0]?.year);
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
      const completed = getCompletedSeason(seasons, seasonDef, year);
      return {
        inSeason: false,
        seasonYear: seasonDef.year,
        previousSeasonYear: completed.year,
        previousSeasonDisplay: completed.displayName ?? String(completed.year),
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

function isEventCompleted(event) {
  return event?.status?.type?.completed || event?.status?.type?.state === 'post';
}

function extractChampionFromEvent(event) {
  if (!event || !isEventCompleted(event)) return null;
  const comps = event.competitions?.[0]?.competitors || [];
  const winner = comps.find((c) => c.winner);
  const loser = comps.find((c) => !c.winner);
  if (!winner) return null;
  return {
    eventName: event.name,
    date: event.date,
    winner: {
      id: winner.team?.id,
      name: winner.team?.displayName || winner.team?.name,
      abbr: winner.team?.abbreviation,
      logo: winner.team?.logo || winner.team?.logos?.[0]?.href || '',
      score: winner.score,
    },
    runnerUp: loser ? {
      name: loser.team?.displayName || loser.team?.name,
      abbr: loser.team?.abbreviation,
      score: loser.score,
    } : null,
  };
}

function getChampionScanMonths(sportId, prevYear) {
  switch (sportId) {
    case 'nfl': return [[prevYear + 1, 2]];
    case 'nba': return [[prevYear, 6]];
    case 'nhl': return [[prevYear, 6]];
    case 'mlb': return [[prevYear, 10], [prevYear, 11]];
    case 'mls': return [[prevYear, 12]];
    case 'wnba': return [[prevYear, 10]];
    case 'ncaaf': return [[prevYear + 1, 1]];
    default: return [[prevYear, 6]];
  }
}

async function fetchLastPostseasonChampion(base, season) {
  const data = await fetchJSON(`${base}/scoreboard?seasontype=3&season=${season}&limit=300`)
    .catch(() => ({ events: [] }));
  const withWinner = (data.events || []).filter(
    (e) => isEventCompleted(e) && (e.competitions?.[0]?.competitors || []).some((c) => c.winner),
  );
  withWinner.sort((a, b) => new Date(a.date) - new Date(b.date));
  return extractChampionFromEvent(withWinner[withWinner.length - 1]);
}

async function scanMonthForChampion(base, year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let day = daysInMonth; day >= 1; day--) {
    const ymd = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    const data = await fetchJSON(`${base}/scoreboard?dates=${ymd}`).catch(() => ({ events: [] }));
    const wins = (data.events || []).filter(
      (e) => isEventCompleted(e) && (e.competitions?.[0]?.competitors || []).some((c) => c.winner),
    );
    if (wins.length) return extractChampionFromEvent(wins[wins.length - 1]);
  }
  return null;
}

async function fetchSeasonChampion({ id, category, league }, seasonStatus) {
  const prevYear = seasonStatus.previousSeasonYear;
  if (!prevYear) return null;
  const base = `https://site.api.espn.com/apis/site/v2/sports/${category}/${league}`;

  let champ = await fetchLastPostseasonChampion(base, prevYear);
  if (!champ) champ = await fetchLastPostseasonChampion(base, prevYear - 1);

  if (!champ) {
    for (const [year, month] of getChampionScanMonths(id, prevYear)) {
      champ = await scanMonthForChampion(base, year, month);
      if (champ) break;
    }
  }

  if (!champ) return null;
  return {
    fetchedAt: new Date().toISOString(),
    sportId: id,
    seasonYear: prevYear,
    seasonDisplay: seasonStatus.previousSeasonDisplay || String(prevYear),
    ...champ,
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

  if (!seasonStatus.inSeason) {
    const champion = await fetchSeasonChampion({ id, category, league }, seasonStatus);
    if (champion) {
      await writeJSON(`${id}/champion.json`, champion);
    }
  }

  const status = seasonStatus.inSeason ? 'in-season' : `off-season (${seasonStatus.previousSeasonDisplay})`;
  console.log(`${id}: ${scoreboard.events?.length ?? 0} events, ${liveCount} live, ${status}`);
  return { id, events: scoreboard.events?.length ?? 0, liveCount, inSeason: seasonStatus.inSeason };
}

const FIFA_LIVE_ELAPSED = new Set([
  'live', 'inplay', 'playing', '1sthalf', '2ndhalf', 'extratime', 'extra', 'penalties',
]);

function normalizeFifaElapsed(raw) {
  return String(raw || '').toLowerCase().replace(/\s+/g, '');
}

function isFifaLiveGame(game) {
  if (!game || game.finished === 'TRUE') return false;
  const e = normalizeFifaElapsed(game.time_elapsed);
  if (!e || e === 'notstarted' || e === 'finished' || e === 'ft') return false;
  if (e === 'ht' || e === 'halftime') return true;
  if (FIFA_LIVE_ELAPSED.has(e)) return true;
  return /\d/.test(e);
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
  const liveCount = gameList.filter(isFifaLiveGame).length;
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