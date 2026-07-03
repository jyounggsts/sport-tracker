const DATA_BASE = 'data';
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports';
const FIFA_API = 'https://worldcup26.ir/get';
const FAV_KEY = 'sport-tracker-favorites';

const POLL = { LIVE: 5_000, WINDOW: 8_000, ACTIVE: 12_000, IDLE: 30_000 };

const state = {
  manifest: null,
  view: 'sport',
  selectedSport: 'nfl',
  scoreboard: null,
  standings: null,
  standingsPrev: null,
  champion: null,
  seasonStatus: null,
  allBoards: {},
  fifa: { teams: {}, groups: [], games: [], seasonStatus: null },
  liveCounts: {},
  seasonSummary: {},
  selectedStandingsTab: 0,
  hasEspnLive: false,
  hasEspnSoon: false,
  pollTimer: null,
  tickTimer: null,
  lastFetch: null,
  fifaActive: false,
};

const $ = (sel) => document.querySelector(sel);

// ── Favorites (localStorage) ─────────────────────────────────────

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); }
  catch { return []; }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

function favKey(sportId, teamId) {
  return `${sportId}:${teamId}`;
}

function isFavorite(sportId, teamId) {
  return getFavorites().some((f) => f.key === favKey(sportId, teamId));
}

function toggleFavorite(team) {
  const key = favKey(team.sportId, team.teamId);
  let favs = getFavorites();
  if (favs.some((f) => f.key === key)) {
    favs = favs.filter((f) => f.key !== key);
  } else {
    favs.push({ key, ...team });
  }
  saveFavorites(favs);
  document.querySelectorAll(`[data-fav-key="${key}"]`).forEach((btn) => {
    btn.classList.toggle('starred', isFavorite(team.sportId, team.teamId));
    btn.setAttribute('aria-pressed', btn.classList.contains('starred'));
  });
  if (state.view === 'my-teams') renderMyTeams();
  return favs;
}

function hasFavorites() {
  return getFavorites().length > 0;
}

function renderStarBtn(team, small = false) {
  const starred = isFavorite(team.sportId, team.teamId);
  const cls = small ? 'star-btn star-btn-sm' : 'star-btn';
  return `<button class="${cls}${starred ? ' starred' : ''}" data-fav-key="${favKey(team.sportId, team.teamId)}" data-fav='${esc(JSON.stringify(team))}' aria-label="Favorite team" aria-pressed="${starred}">★</button>`;
}

function bindStarButtons(root = document) {
  root.querySelectorAll('.star-btn').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      try { toggleFavorite(JSON.parse(btn.dataset.fav)); }
      catch { /* ignore */ }
    };
  });
}

// ── Routing / history ────────────────────────────────────────────

function parseHash() {
  const hash = location.hash.replace('#', '');
  if (hash === 'my-teams') return { view: 'my-teams' };
  if (hash && getSport(hash)) return { view: 'sport', sport: hash };
  return null;
}

function navigate(route, { replace = false } = {}) {
  state.view = route.view;
  if (route.sport) state.selectedSport = route.sport;
  const hash = route.view === 'my-teams' ? '#my-teams' : `#${state.selectedSport}`;
  const method = replace ? 'replaceState' : 'pushState';
  history[method]({ ...route }, '', hash);
  updateViewVisibility();
}

function updateViewVisibility() {
  const myView = $('#view-my-teams');
  const sportView = $('#view-sport');
  const genericView = $('#view-sport-generic');
  const fifaView = $('#view-fifa');
  const hero = $('#hero');
  const isFifaSport = state.view === 'sport' && isFifa(getSport(state.selectedSport));

  if (state.view === 'my-teams') {
    myView.hidden = false;
    sportView.hidden = true;
    if (state.fifaActive) { window.FifaTracker?.destroy(); state.fifaActive = false; }
    document.title = 'My Teams | Sport Tracker';
    return;
  }

  myView.hidden = true;
  sportView.hidden = false;
  const sport = getSport(state.selectedSport);
  document.title = `${sport?.name || 'Sport'} | Sport Tracker`;

  if (genericView) genericView.hidden = isFifaSport;
  if (fifaView) fifaView.hidden = !isFifaSport;
  if (hero) hero.hidden = isFifaSport;
}

// ── Data fetching ──────────────────────────────────────────────────

async function fetchCached(path) {
  const res = await fetch(`${DATA_BASE}/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
  return res.json();
}

async function fetchEspnScoreboard(sport) {
  const res = await fetch(`${ESPN_SITE}/${sport.category}/${sport.league}/scoreboard`);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

async function fetchEspnStandings(sport, season) {
  const url = season
    ? `${ESPN_V2}/${sport.category}/${sport.league}/standings?season=${season}`
    : `${ESPN_V2}/${sport.category}/${sport.league}/standings`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

async function fetchFifaEndpoint(endpoint) {
  try {
    return await fetchCached(`fifa/${endpoint}.json`);
  } catch {
    const res = await fetch(`${FIFA_API}/${endpoint}`);
    if (!res.ok) throw new Error(`FIFA HTTP ${res.status}`);
    return res.json();
  }
}

async function loadManifest() {
  try {
    state.manifest = await fetchCached('manifest.json');
    state.seasonSummary = state.manifest.seasonSummary || {};
  } catch {
    state.manifest = { sports: [], seasonSummary: {} };
  }
}

function getSport(id) {
  return state.manifest?.sports?.find((s) => s.id === id);
}

function isFifa(sport) {
  return sport?.source === 'worldcup26' || sport?.id === 'fifa';
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

function detectSeasonStatusClient(standings, scoreboard) {
  if (standings?.seasonStatus) return standings.seasonStatus;
  const now = Date.now();
  const seasons = standings?.seasons || [];
  const year = getScoreboardSeasonYear(scoreboard, seasons[0]?.year);
  const seasonDef = seasons.find((s) => s.year === year) ?? seasons[0];
  if (!seasonDef) return { inSeason: true, seasonYear: year };

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
  return { inSeason: true, seasonYear: seasonDef.year };
}

async function loadSportData(sportId) {
  const sport = getSport(sportId);
  if (!sport) return;

  if (isFifa(sport)) {
    const [teamsData, groupsData, gamesData, seasonData] = await Promise.all([
      fetchFifaEndpoint('teams'),
      fetchFifaEndpoint('groups'),
      fetchFifaEndpoint('games'),
      fetchCached('fifa/season.json').catch(() => ({ seasonStatus: null })),
    ]);
    state.fifa.teams = Object.fromEntries((teamsData.teams || []).map((t) => [t.id, t]));
    state.fifa.groups = groupsData.groups || [];
    state.fifa.games = gamesData.games || [];
    const remaining = state.fifa.games.filter((g) => g.finished !== 'TRUE').length;
    state.fifa.seasonStatus = seasonData.seasonStatus || {
      inSeason: remaining > 0,
      label: remaining > 0 ? 'Tournament Active' : 'Out of Season',
      previousSeasonDisplay: '2022',
      returnsDate: '2026-06-11',
    };
    state.seasonStatus = state.fifa.seasonStatus;
    state.scoreboard = null;
    state.standings = null;
    state.standingsPrev = null;
    return;
  }

  try {
    state.scoreboard = await fetchCached(`${sportId}/scoreboard.json`);
  } catch {
    state.scoreboard = await fetchEspnScoreboard(sport).catch(() => ({ events: [] }));
  }

  try {
    state.standings = await fetchCached(`${sportId}/standings.json`);
  } catch {
    state.standings = await fetchEspnStandings(sport).catch(() => ({ children: [] }));
  }

  state.seasonStatus = detectSeasonStatusClient(state.standings, state.scoreboard);

  if (!state.seasonStatus.inSeason) {
    try {
      state.standingsPrev = await fetchCached(`${sportId}/standings-prev.json`);
    } catch {
      if (state.seasonStatus.previousSeasonYear) {
        state.standingsPrev = await fetchEspnStandings(sport, state.seasonStatus.previousSeasonYear)
          .catch(() => null);
      } else {
        state.standingsPrev = null;
      }
    }
    try {
      state.champion = await fetchCached(`${sportId}/champion.json`);
    } catch {
      state.champion = null;
    }
  } else {
    state.standingsPrev = null;
    state.champion = null;
  }
}

async function loadAllScoreboards() {
  const boards = {};
  await Promise.all(
    (state.manifest?.sports || []).map(async (sport) => {
      try {
        if (isFifa(sport)) {
          const data = await fetchFifaEndpoint('games');
          boards[sport.id] = { type: 'fifa', games: data.games || [] };
        } else {
          const data = await fetchCached(`${sport.id}/scoreboard.json`)
            .catch(() => fetchEspnScoreboard(sport));
          boards[sport.id] = { type: 'espn', ...data };
        }
      } catch {
        boards[sport.id] = { type: 'espn', events: [] };
      }
    }),
  );
  state.allBoards = boards;
}

async function loadAllLiveCounts() {
  const counts = {};
  await Promise.all(
    (state.manifest?.sports || []).map(async (sport) => {
      try {
        if (isFifa(sport)) {
          const data = await fetchCached('fifa/games.json').catch(() => fetchFifaEndpoint('games'));
          counts[sport.id] = (data.games || []).filter((g) => {
            const elapsed = String(g.time_elapsed || '').toLowerCase();
            return g.finished !== 'TRUE' && !['finished', 'ft', ''].includes(elapsed);
          }).length;
        } else {
          const data = await fetchCached(`${sport.id}/scoreboard.json`).catch(() => fetchEspnScoreboard(sport));
          counts[sport.id] = (data.events || []).filter((e) => e.status?.type?.state === 'in').length;
        }
      } catch {
        counts[sport.id] = 0;
      }
    }),
  );
  state.liveCounts = counts;
}

// ── Odds (FIFA tracker pattern) ──────────────────────────────────

function formatAmericanOdds(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  if (!s) return null;
  if (s.startsWith('+') || s.startsWith('-')) return s;
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return n > 0 ? `+${n}` : String(n);
}

function pickOddsVal(obj) {
  return obj?.current?.odds ?? obj?.close?.odds ?? obj?.open?.odds ?? null;
}

function pickSpreadLine(obj) {
  return obj?.current?.line ?? obj?.close?.line ?? obj?.open?.line ?? null;
}

function parseTotalLine(line) {
  if (!line) return null;
  return String(line).replace(/^[ou]/i, '');
}

function parseEspnOdds(oddsArr) {
  const raw = oddsArr?.[0];
  if (!raw) return null;
  const ml = raw.moneyline || {};
  const spread = raw.pointSpread || {};
  const total = raw.total || {};
  const homeMl = formatAmericanOdds(pickOddsVal(ml.home));
  const awayMl = formatAmericanOdds(pickOddsVal(ml.away));
  const drawMl = formatAmericanOdds(pickOddsVal(ml.draw) ?? raw.drawOdds?.moneyLine);
  if (!homeMl && !awayMl && !drawMl) return null;
  return {
    provider: raw.provider?.displayName || 'DraftKings',
    summary: raw.details || '',
    moneyline: { home: homeMl, away: awayMl, draw: drawMl },
    spread: {
      homeLine: pickSpreadLine(spread.home),
      homeOdds: formatAmericanOdds(pickOddsVal(spread.home)),
      awayLine: pickSpreadLine(spread.away),
      awayOdds: formatAmericanOdds(pickOddsVal(spread.away)),
    },
    total: {
      line: raw.overUnder ?? parseTotalLine(total.over?.close?.line) ?? parseTotalLine(total.over?.current?.line),
      over: formatAmericanOdds(pickOddsVal(total.over)),
      under: formatAmericanOdds(pickOddsVal(total.under)),
    },
  };
}

function getOddsTone(val) {
  if (!val) return '';
  const n = Number(String(val).replace('+', ''));
  if (Number.isNaN(n)) return '';
  if (n < 0) return 'fav';
  if (n > 0) return 'dog';
  return '';
}

function oddsTitle(val) {
  const n = Number(String(val).replace('+', ''));
  if (Number.isNaN(n)) return 'Betting odds';
  if (n < 0) return `Favorite — bet $${Math.abs(n)} to win $100`;
  return `Underdog — bet $100 to win $${n}`;
}

function renderOddsBlock(odds, phase) {
  if (!odds || phase === 'final') return '';
  const { moneyline: ml, spread, total } = odds;
  const mid = [
    spread.homeLine ? `${spread.homeLine}` : '',
    total.line ? `O/U ${total.line}` : '',
    odds.summary || '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="game-odds">
      <span class="odds-ml ${getOddsTone(ml.away)}" title="${esc(oddsTitle(ml.away))}">${esc(ml.away || '')}</span>
      <span class="odds-mid">${esc(mid)}</span>
      <span class="odds-ml ${getOddsTone(ml.home)}" title="${esc(oddsTitle(ml.home))}">${esc(ml.home || '')}</span>
    </div>
    <div class="odds-provider">${esc(odds.provider)}</div>`;
}

// ── Helpers ──────────────────────────────────────────────────────

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str ?? '';
  return el.innerHTML;
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatReturnsDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function getEventStatus(event) {
  const type = event.status?.type || {};
  if (type.state === 'in') return { label: type.shortDetail || 'LIVE', cls: 'live', phase: 'live' };
  if (type.completed || type.state === 'post') return { label: type.shortDetail || 'Final', cls: 'final', phase: 'final' };
  return { label: type.shortDetail || formatTime(event.date), cls: 'scheduled', phase: 'upcoming' };
}

function getCompetitors(event) {
  const comps = event.competitions?.[0]?.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0];
  const away = comps.find((c) => c.homeAway === 'away') || comps[1];
  return { home, away, competition: event.competitions?.[0] };
}

function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color || '#ff2d2d');
  document.documentElement.style.setProperty('--accent-dark', color || '#cc0000');
  document.documentElement.style.setProperty('--accent-glow', `${color || '#ff2d2d'}55`);
}

function teamFavObj(sportId, comp) {
  const sport = getSport(sportId);
  return {
    sportId,
    teamId: String(comp.team?.id || comp.team?.uid || ''),
    name: comp.team?.displayName || comp.team?.name || '',
    abbr: comp.team?.abbreviation || '',
    logo: comp.team?.logo || comp.team?.logos?.[0]?.href || '',
    sportName: sport?.shortName || sport?.name || sportId,
  };
}

function fifaTeamFavObj(team, sportId = 'fifa') {
  return {
    sportId,
    teamId: String(team.id),
    name: team.name_en || '',
    abbr: team.fifa_code || '',
    logo: team.flag || '',
    sportName: 'WC26',
  };
}

function parseFifaDate(localDate) {
  if (!localDate) return new Date();
  const [datePart, timePart] = localDate.split(' ');
  const [month, day, year] = datePart.split('/').map(Number);
  const [hour, minute] = (timePart || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function isFifaLive(game) {
  const elapsed = String(game.time_elapsed || '').toLowerCase();
  return game.finished !== 'TRUE' && !['finished', 'ft', ''].includes(elapsed);
}

function eventHasFavorite(event, sportId) {
  const favIds = new Set(getFavorites().filter((f) => f.sportId === sportId).map((f) => f.teamId));
  const { home, away } = getCompetitors(event);
  return favIds.has(String(home?.team?.id)) || favIds.has(String(away?.team?.id));
}

function fifaHasFavorite(game) {
  const favIds = new Set(getFavorites().filter((f) => f.sportId === 'fifa').map((f) => f.teamId));
  return favIds.has(String(game.home_team_id)) || favIds.has(String(game.away_team_id));
}

// ── Navigation render ─────────────────────────────────────────────

function renderSportNav() {
  const nav = $('#sport-nav');
  const myActive = state.view === 'my-teams' ? 'active' : '';
  const myBadge = hasFavorites() ? `<span class="badge">${getFavorites().length}</span>` : '';
  let html = `<a href="#my-teams" class="sport-link ${myActive}" data-view="my-teams">★ My Teams ${myBadge}</a>`;

  html += (state.manifest?.sports || []).map((sport) => {
    const live = state.liveCounts[sport.id] || 0;
    const active = state.view === 'sport' && sport.id === state.selectedSport ? 'active' : '';
    const off = state.seasonSummary[sport.id] === false ? ' off-season' : '';
    const badge = live > 0 ? `<span class="badge">${live}</span>` : '';
    return `<a href="#${sport.id}" class="sport-link ${active}${off}" data-sport="${sport.id}">${sport.icon || ''} ${esc(sport.shortName || sport.name)} ${badge}</a>`;
  }).join('');

  nav.innerHTML = html;
  nav.querySelectorAll('[data-view]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      goMyTeams();
    });
  });
  nav.querySelectorAll('[data-sport]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      goSport(link.dataset.sport);
    });
  });
}

function renderSportCards() {
  const grid = $('#sport-cards');
  grid.innerHTML = (state.manifest?.sports || []).map((sport) => {
    const live = state.liveCounts[sport.id] || 0;
    const active = state.view === 'sport' && sport.id === state.selectedSport ? 'active' : '';
    const inSeason = state.seasonSummary[sport.id] !== false;
    let meta = live > 0 ? `${live} live now` : inSeason ? 'View scores' : 'Off season';
    return `
      <div class="sport-card ${active}${inSeason ? '' : ' off-season'}" data-sport="${sport.id}">
        <div class="sport-card-icon">${sport.icon || '🏆'}</div>
        <div class="sport-card-name">${esc(sport.name)}</div>
        <div class="sport-card-meta">${meta}</div>
      </div>`;
  }).join('');
  grid.querySelectorAll('.sport-card').forEach((card) => {
    card.addEventListener('click', () => goSport(card.dataset.sport));
  });
}

function renderSeasonBanner() {
  const banner = $('#season-banner');
  const ss = state.seasonStatus;
  if (!ss || ss.inSeason !== false) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  const sport = getSport(state.selectedSport);
  const returns = ss.returnsDate ? ` Returns ${formatReturnsDate(ss.returnsDate)}.` : '';
  banner.innerHTML = `
    <div class="season-banner-inner">
      <span class="season-badge">OFF SEASON</span>
      <span>${esc(sport?.name || '')} is currently out of season.${returns}</span>
    </div>`;
  banner.hidden = false;
}

function renderSeasonChampion() {
  const el = $('#season-champion');
  if (!el) return;
  const inSeason = state.seasonStatus?.inSeason !== false;
  if (inSeason || !state.champion?.winner) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const c = state.champion;
  const seasonLabel = c.seasonDisplay || state.seasonStatus?.previousSeasonDisplay || 'Last season';
  const logo = c.winner.logo
    ? `<img class="champion-logo" src="${esc(c.winner.logo)}" alt="" loading="lazy">`
    : '';
  const scoreLine = c.runnerUp
    ? `${esc(c.winner.score)}–${esc(c.runnerUp.score)} vs ${esc(c.runnerUp.name)}`
    : '';
  el.innerHTML = `
    <div class="champion-card">
      <div class="champion-label">${esc(seasonLabel)} Champion</div>
      <div class="champion-main">
        ${logo}
        <div class="champion-info">
          <div class="champion-name">${esc(c.winner.name)}</div>
          ${scoreLine ? `<div class="champion-score">${scoreLine}</div>` : ''}
        </div>
      </div>
    </div>`;
  el.hidden = false;
}

function setOffSeasonSections() {
  const inSeason = state.seasonStatus?.inSeason !== false;
  const live = $('#sport-live');
  const schedule = $('#sport-schedule');
  if (live) live.hidden = !inSeason;
  if (schedule) schedule.hidden = !inSeason;
  if (!inSeason) {
    const banner = $('#live-banner');
    if (banner) banner.hidden = true;
  }
}

// ── Game card builders ───────────────────────────────────────────

function renderTeamRow(comp, sportId, isWinner, extraCls, showStar = true) {
  if (!comp) return '';
  const cls = [isWinner ? 'winner' : '', extraCls].filter(Boolean).join(' ');
  const logo = comp.team?.logo
    ? `<img class="team-logo" src="${esc(comp.team.logo)}" alt="" loading="lazy">`
    : '';
  const star = showStar ? renderStarBtn(teamFavObj(sportId, comp), true) : '';
  return `
    <div class="team-row ${cls}">
      ${logo}
      <span class="team-name">${esc(comp.team?.displayName || comp.team?.name || 'TBD')}</span>
      ${star}
      <span class="team-score">${esc(comp.score ?? '-')}</span>
    </div>`;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Starting';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getEspnFootText(event, status) {
  if (status.phase === 'live') return status.label;
  if (status.phase === 'final') return 'Final';
  const diff = new Date(event.date) - Date.now();
  if (diff > 60_000) return `Starts in ${formatCountdown(diff)}`;
  if (diff > 0) return `Kickoff in ${formatCountdown(diff)}`;
  return status.label;
}

function buildEspnGameCard(event, sportId, { highlight = false } = {}) {
  const { home, away, competition } = getCompetitors(event);
  const status = getEventStatus(event);
  const isLive = status.phase === 'live';
  const isFinal = status.phase === 'final';
  const homeScore = Number(home?.score ?? 0);
  const awayScore = Number(away?.score ?? 0);
  const odds = parseEspnOdds(competition?.odds);
  const showOdds = state.seasonStatus?.inSeason !== false;
  const sport = getSport(sportId);
  const footText = getEspnFootText(event, status);

  return `
    <article class="game-card ${status.phase}${highlight ? ' fav-game' : ''}" data-event-id="${event.id}">
      <div class="game-card-head">
        <span>${esc(sport?.shortName || '')} · ${esc(competition?.type?.abbreviation || competition?.notes?.[0]?.headline || '')}</span>
        <span class="game-status ${status.cls}" data-status="${event.id}">${esc(status.label)}</span>
      </div>
      <div class="game-card-body">
        ${renderTeamRow(away, sportId, isFinal && awayScore > homeScore, isFinal && awayScore < homeScore ? 'loser' : '')}
        ${renderTeamRow(home, sportId, isFinal && homeScore > awayScore, isFinal && homeScore < awayScore ? 'loser' : '')}
        <div class="game-odds-wrap" data-odds="${event.id}">${showOdds ? renderOddsBlock(odds, status.phase) : ''}</div>
      </div>
      <div class="game-card-foot">
        <span data-venue="${event.id}">${esc(competition?.venue?.fullName || competition?.broadcast || '')}</span>
        <span data-countdown="${event.id}" class="${isLive ? 'live-text' : ''}">${esc(footText)}</span>
        <a href="${esc(event.links?.[0]?.href || 'https://www.espn.com')}" target="_blank" rel="noopener">Details</a>
      </div>
    </article>`;
}

function patchEspnGameCard(card, event, sportId) {
  const { home, away, competition } = getCompetitors(event);
  const status = getEventStatus(event);
  card.className = `game-card ${status.phase}${card.classList.contains('fav-game') ? ' fav-game' : ''}`;

  const statusEl = card.querySelector(`[data-status="${event.id}"]`);
  if (statusEl) {
    statusEl.textContent = status.label;
    statusEl.className = `game-status ${status.cls}`;
  }

  const rows = card.querySelectorAll('.team-row');
  const awayRow = rows[0];
  const homeRow = rows[1];
  if (awayRow) {
    awayRow.querySelector('.team-score').textContent = away?.score ?? '-';
    awayRow.classList.toggle('winner', status.phase === 'final' && Number(away?.score) > Number(home?.score));
    awayRow.classList.toggle('loser', status.phase === 'final' && Number(away?.score) < Number(home?.score));
  }
  if (homeRow) {
    homeRow.querySelector('.team-score').textContent = home?.score ?? '-';
    homeRow.classList.toggle('winner', status.phase === 'final' && Number(home?.score) > Number(away?.score));
    homeRow.classList.toggle('loser', status.phase === 'final' && Number(home?.score) < Number(away?.score));
  }

  const oddsWrap = card.querySelector(`[data-odds="${event.id}"]`);
  if (oddsWrap && state.seasonStatus?.inSeason !== false) {
    const odds = parseEspnOdds(competition?.odds);
    oddsWrap.innerHTML = renderOddsBlock(odds, status.phase);
  }

  const countdown = card.querySelector(`[data-countdown="${event.id}"]`);
  if (countdown) {
    countdown.textContent = getEspnFootText(event, status);
    countdown.classList.toggle('live-text', status.phase === 'live');
  }
}

function renderFifaTeamRow(team, score, isWinner) {
  const flag = team.flag ? `<img class="team-flag" src="${esc(team.flag)}" alt="" loading="lazy">` : '';
  const star = renderStarBtn(fifaTeamFavObj(team), true);
  return `
    <div class="team-row ${isWinner ? 'winner' : ''}">
      ${flag}
      <span class="team-name">${esc(team.name_en || 'TBD')}</span>
      ${star}
      <span class="team-score">${esc(score)}</span>
    </div>`;
}

function buildFifaGameCard(g, { highlight = false } = {}) {
  const home = state.fifa.teams[g.home_team_id] || {};
  const away = state.fifa.teams[g.away_team_id] || {};
  const live = isFifaLive(g);
  const isFinal = g.finished === 'TRUE';
  const homeScore = Number(g.home_score || 0);
  const awayScore = Number(g.away_score || 0);
  return `
    <article class="game-card ${live ? 'live' : ''}${highlight ? ' fav-game' : ''}">
      <div class="game-card-head">
        <span>WC26 · Group ${esc(g.group)}</span>
        <span class="game-status ${live ? 'live' : isFinal ? 'final' : 'scheduled'}">${live ? esc(g.time_elapsed || 'LIVE') : isFinal ? 'FT' : formatTime(parseFifaDate(g.local_date))}</span>
      </div>
      <div class="game-card-body">
        ${renderFifaTeamRow(away, awayScore, isFinal && awayScore > homeScore)}
        ${renderFifaTeamRow(home, homeScore, isFinal && homeScore > awayScore)}
      </div>
      <div class="game-card-foot">
        <span>${esc(g.type)} stage</span>
        <span>${formatTime(parseFifaDate(g.local_date))}</span>
      </div>
    </article>`;
}

// ── Sport view renders ───────────────────────────────────────────

function updateEspnLiveFlags() {
  const events = state.scoreboard?.events || [];
  state.hasEspnLive = events.some((e) => e.status?.type?.state === 'in');
  state.hasEspnSoon = events.some((e) => {
    if (e.status?.type?.state !== 'pre') return false;
    const diff = new Date(e.date) - Date.now();
    return diff > 0 && diff <= 2 * 60 * 60 * 1000;
  });
}

function renderEspnScoreboard() {
  const grid = $('#scoreboard-grid');
  const inSeason = state.seasonStatus?.inSeason !== false;

  if (!inSeason) {
    state.hasEspnLive = false;
    state.hasEspnSoon = false;
    grid.innerHTML = '';
    return;
  }

  const events = state.scoreboard?.events || [];
  updateEspnLiveFlags();

  const today = events.filter((e) => isToday(e.date));
  const live = today.filter((e) => e.status?.type?.state === 'in');
  const rest = today.filter((e) => e.status?.type?.state !== 'in');
  $('#sport-today-meta').textContent = today.length
    ? `${live.length} live · ${today.length} games today`
    : `${events.length} games on the schedule`;

  const show = [...live, ...rest].slice(0, 24);
  if (!show.length) {
    grid.innerHTML = '<div class="empty-state">No games scheduled for today. Check Upcoming below.</div>';
    return;
  }

  const nextIds = new Set(show.map((e) => String(e.id)));
  grid.querySelectorAll('.game-card[data-event-id]').forEach((card) => {
    if (!nextIds.has(card.dataset.eventId)) card.remove();
  });

  show.forEach((event) => {
    const id = String(event.id);
    let card = grid.querySelector(`.game-card[data-event-id="${id}"]`);
    if (card) {
      patchEspnGameCard(card, event, state.selectedSport);
    } else {
      grid.insertAdjacentHTML('beforeend', buildEspnGameCard(event, state.selectedSport));
    }
  });
  bindStarButtons(grid);
  renderEspnLiveBanner();
}

function getStandingsGroups(data) {
  return (data?.children || []).filter((c) => c.standings?.entries?.length);
}

function renderStandingsTabs(groups) {
  const tabs = $('#standings-tabs');
  if (!groups.length) { tabs.innerHTML = ''; return; }
  tabs.innerHTML = groups.map((g, i) => {
    const active = i === state.selectedStandingsTab ? 'active' : '';
    return `<button class="group-tab ${active}" data-tab="${i}" role="tab">${esc(g.shortName || g.name)}</button>`;
  }).join('');
  tabs.querySelectorAll('.group-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedStandingsTab = Number(btn.dataset.tab);
      renderStandingsTabs(groups);
      renderStandingsTable(groups);
    });
  });
}

function renderEspnLiveBanner() {
  const banner = $('#live-banner');
  const inner = $('#live-banner-matches');
  const liveEvents = (state.scoreboard?.events || []).filter((e) => e.status?.type?.state === 'in');
  if (!liveEvents.length || state.fifaActive) {
    if (!state.fifaActive) banner.hidden = true;
    return;
  }
  inner.innerHTML = liveEvents.map((e) => {
    const { home, away } = getCompetitors(e);
    const sport = getSport(state.selectedSport);
    return `<span class="ticker-item"><span class="ticker-live">LIVE</span> ${esc(sport?.shortName || '')} ${esc(away?.team?.abbreviation)} ${away?.score}-${home?.score} ${esc(home?.team?.abbreviation)}</span>`;
  }).join('');
  banner.hidden = false;
}

function renderStandingsTable(groups) {
  const layout = $('#sport-standings-layout');
  if (!groups.length) {
    layout.innerHTML = '<div class="empty-state">Standings not available.</div>';
    return;
  }
  const group = groups[state.selectedStandingsTab] || groups[0];
  const entries = [...(group.standings?.entries || [])].sort(
    (a, b) => (a.stats?.find((s) => s.name === 'rank')?.value ?? 99) - (b.stats?.find((s) => s.name === 'rank')?.value ?? 99),
  );
  const headers = ['#', 'Team', 'W', 'L', 'T', 'PCT', 'PF', 'PA', 'DIFF'];

  layout.innerHTML = `
    <div class="standings-table-wrap">
      <table class="standings-table">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
          ${entries.map((entry) => {
            const team = entry.team || {};
            const stats = Object.fromEntries((entry.stats || []).map((s) => [s.name, s.displayValue ?? s.value]));
            const logo = team.logos?.[0]?.href
              ? `<img class="team-logo" src="${esc(team.logos[0].href)}" alt="" width="20" height="20">`
              : '';
            const fav = {
              sportId: state.selectedSport,
              teamId: String(team.id),
              name: team.displayName || team.name,
              abbr: team.abbreviation || '',
              logo: team.logos?.[0]?.href || '',
              sportName: getSport(state.selectedSport)?.shortName || '',
            };
            return `<tr>
              <td class="rank">${esc(stats.rank ?? '')}</td>
              <td><div class="team-cell">${logo} ${esc(team.displayName || team.name)} ${renderStarBtn(fav, true)}</div></td>
              <td class="num">${esc(stats.wins ?? '-')}</td>
              <td class="num">${esc(stats.losses ?? '-')}</td>
              <td class="num">${esc(stats.ties ?? '0')}</td>
              <td class="num">${esc(stats.winPercent ?? '-')}</td>
              <td class="num">${esc(stats.pointsFor ?? '-')}</td>
              <td class="num">${esc(stats.pointsAgainst ?? '-')}</td>
              <td class="num">${esc(stats.differential ?? stats.pointDifferential ?? '-')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  bindStarButtons(layout);
}

function renderStandings() {
  const title = $('#standings-title');
  const inSeason = state.seasonStatus?.inSeason !== false;
  const usePrev = !inSeason && state.standingsPrev;
  const data = usePrev ? state.standingsPrev : state.standings;
  const groups = getStandingsGroups(data);

  if (usePrev) {
    title.textContent = `${state.seasonStatus.previousSeasonDisplay || 'Previous'} Standings`;
  } else {
    title.textContent = 'Standings';
  }

  renderStandingsTabs(groups);
  renderStandingsTable(groups);
}

function renderEspnSchedule() {
  const list = $('#schedule-list');
  const inSeason = state.seasonStatus?.inSeason !== false;
  if (!inSeason) {
    $('#schedule-meta').textContent = 'Season not active';
    list.innerHTML = '<div class="empty-state">No upcoming games — league is out of season.</div>';
    return;
  }
  const events = (state.scoreboard?.events || [])
    .filter((e) => e.status?.type?.state === 'pre')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 12);
  $('#schedule-meta').textContent = events.length ? 'Next games on the schedule' : 'No upcoming games found';
  if (!events.length) {
    list.innerHTML = '<div class="empty-state">No upcoming games in the current scoreboard window.</div>';
    return;
  }
  list.innerHTML = events.map((event) => {
    const { home, away, competition } = getCompetitors(event);
    const odds = parseEspnOdds(competition?.odds);
    const oddsStr = odds?.summary ? ` · ${odds.summary}` : '';
    return `
      <div class="schedule-row">
        <span class="schedule-time">${formatDate(event.date)}<br>${formatTime(event.date)}</span>
        <span class="schedule-match">${esc(away?.team?.displayName)} @ ${esc(home?.team?.displayName)}${esc(oddsStr)}</span>
        <span class="schedule-venue">${esc(competition?.venue?.fullName || '')}</span>
      </div>`;
  }).join('');
}

// ── My Teams view ────────────────────────────────────────────────

function collectFavoriteGames() {
  const favs = getFavorites();
  if (!favs.length) return { today: [], upcoming: [] };

  const today = [];
  const upcoming = [];

  for (const sport of state.manifest?.sports || []) {
    if (state.seasonSummary[sport.id] === false) continue;
    const board = state.allBoards[sport.id];
    if (!board) continue;

    if (board.type === 'fifa') {
      (board.games || []).forEach((g) => {
        if (!fifaHasFavorite(g)) return;
        const kickoff = parseFifaDate(g.local_date);
        const item = { type: 'fifa', game: g, sport, date: kickoff, live: isFifaLive(g) };
        if (isToday(kickoff)) today.push(item);
        else if (g.finished !== 'TRUE' && kickoff > new Date()) upcoming.push(item);
      });
    } else {
      (board.events || []).forEach((e) => {
        if (!eventHasFavorite(e, sport.id)) return;
        const item = { type: 'espn', event: e, sport, date: new Date(e.date), live: e.status?.type?.state === 'in' };
        if (isToday(e.date)) today.push(item);
        else if (e.status?.type?.state === 'pre') upcoming.push(item);
      });
    }
  }

  today.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.date - b.date;
  });
  upcoming.sort((a, b) => a.date - b.date);
  return { today, upcoming: upcoming.slice(0, 20) };
}

function renderMyTeams() {
  const favs = getFavorites();
  const bar = $('#fav-teams-bar');
  $('#my-teams-meta').textContent = favs.length
    ? `${favs.length} starred team${favs.length === 1 ? '' : 's'} across all leagues`
    : 'Star teams from any league to track them here';

  if (!favs.length) {
    bar.innerHTML = '<div class="empty-state">No favorite teams yet. Browse a league and tap ★ on any team in standings or game cards.</div>';
    $('#my-today-grid').innerHTML = '';
    $('#my-upcoming-list').innerHTML = '';
    $('#my-today-meta').textContent = '';
    return;
  }

  bar.innerHTML = favs.map((f) => {
    const logo = f.logo ? `<img class="team-logo" src="${esc(f.logo)}" alt="">` : '';
    return `
      <div class="fav-chip" data-sport="${f.sportId}">
        ${logo}
        <span class="fav-chip-name">${esc(f.abbr || f.name)}</span>
        <span class="fav-chip-sport">${esc(f.sportName)}</span>
        <button class="star-btn starred star-btn-sm" data-fav-key="${f.key}" data-fav='${esc(JSON.stringify(f))}' aria-label="Remove favorite">★</button>
      </div>`;
  }).join('');
  bindStarButtons(bar);
  bar.querySelectorAll('.fav-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.star-btn')) return;
      goSport(chip.dataset.sport);
    });
  });

  const { today, upcoming } = collectFavoriteGames();
  const grid = $('#my-today-grid');
  $('#my-today-meta').textContent = today.length
    ? `${today.filter((g) => g.live).length} live · ${today.length} games today`
    : 'No games today for your teams';

  if (!today.length) {
    grid.innerHTML = '<div class="empty-state">None of your teams play today. Check Coming Up below.</div>';
  } else {
    grid.innerHTML = today.map((item) => {
      if (item.type === 'fifa') return buildFifaGameCard(item.game, { highlight: true });
      return buildEspnGameCard(item.event, item.sport.id, { highlight: true });
    }).join('');
    bindStarButtons(grid);
  }

  const list = $('#my-upcoming-list');
  $('#my-upcoming-meta').textContent = upcoming.length ? 'Next games for your teams' : 'No upcoming games found';
  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-state">No upcoming games scheduled for your teams.</div>';
  } else {
    list.innerHTML = upcoming.map((item) => {
      if (item.type === 'fifa') {
        const g = item.game;
        const home = state.fifa.teams[g.home_team_id]?.name_en || 'TBD';
        const away = state.fifa.teams[g.away_team_id]?.name_en || 'TBD';
        return `
          <div class="schedule-row fav-schedule" data-sport="fifa">
            <span class="schedule-time">${formatDate(item.date)}<br>${formatTime(item.date)}</span>
            <span class="schedule-match">WC26 · ${esc(away)} vs ${esc(home)}</span>
            <span class="schedule-venue">Group ${esc(g.group)}</span>
          </div>`;
      }
      const { home, away, competition } = getCompetitors(item.event);
      const odds = parseEspnOdds(competition?.odds);
      return `
        <div class="schedule-row fav-schedule" data-sport="${item.sport.id}">
          <span class="schedule-time">${formatDate(item.date)}<br>${formatTime(item.date)}</span>
          <span class="schedule-match">${esc(item.sport.shortName)} · ${esc(away?.team?.displayName)} @ ${esc(home?.team?.displayName)}${odds?.summary ? ` · ${esc(odds.summary)}` : ''}</span>
          <span class="schedule-venue">${esc(competition?.venue?.fullName || '')}</span>
        </div>`;
    }).join('');
    list.querySelectorAll('.fav-schedule').forEach((row) => {
      row.addEventListener('click', () => goSport(row.dataset.sport));
    });
  }
}

// ── Main render / navigation ─────────────────────────────────────

function renderSportView() {
  const sport = getSport(state.selectedSport);
  if (sport?.accent) setAccent(sport.accent);
  updateViewVisibility();

  if (isFifa(sport)) {
    if (!state.fifaActive && window.FifaTracker) {
      state.fifaActive = true;
      window.FifaTracker.init();
    }
    return;
  }

  if (state.fifaActive) {
    window.FifaTracker?.destroy();
    state.fifaActive = false;
  }

  setOffSeasonSections();
  renderSeasonBanner();
  renderSeasonChampion();
  renderEspnScoreboard();
  renderStandings();
  renderEspnSchedule();
}

function renderAll() {
  renderSportNav();
  renderSportCards();
  renderLiveIndicator();
  if (state.view === 'my-teams') {
    renderMyTeams();
  } else {
    renderSportView();
  }
}

function renderLiveIndicator() {
  const live = state.view === 'my-teams'
    ? Object.values(state.liveCounts).reduce((a, b) => a + b, 0)
    : state.liveCounts[state.selectedSport] || 0;
  const pill = $('#live-indicator');
  if (live > 0) {
    pill.hidden = false;
    $('#live-count-label').textContent = `${live} LIVE`;
  } else {
    pill.hidden = true;
  }
}

async function refresh({ silent = false } = {}) {
  if (state.view === 'sport' && state.fifaActive && isFifa(getSport(state.selectedSport))) {
    window.FifaTracker?.refresh();
    await loadAllLiveCounts();
    renderSportNav();
    renderSportCards();
    renderLiveIndicator();
    schedulePoll();
    return;
  }

  if (!silent && state.view === 'sport' && !isFifa(getSport(state.selectedSport))) {
    $('#scoreboard-grid').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading games...</p></div>';
    $('#sport-standings-layout').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }
  if (!silent && state.view === 'my-teams') {
    $('#my-today-grid').innerHTML = '<div class="loading"><div class="spinner"></div><p>Finding your teams\' games...</p></div>';
  }

  try {
    await loadAllLiveCounts();
    if (state.view === 'my-teams') {
      await loadAllScoreboards();
      const teamsData = await fetchFifaEndpoint('teams').catch(() => ({ teams: [] }));
      state.fifa.teams = Object.fromEntries((teamsData.teams || []).map((t) => [t.id, t]));
    } else if (!isFifa(getSport(state.selectedSport))) {
      await loadSportData(state.selectedSport);
    }
    state.lastFetch = new Date();
    renderAll();
    schedulePoll();
  } catch (err) {
    console.error(err);
    if (state.view === 'sport' && !isFifa(getSport(state.selectedSport))) {
      $('#scoreboard-grid').innerHTML = `<div class="empty-state">Failed to load: ${esc(err.message)}</div>`;
    }
  }
}

function getPollInterval() {
  if (state.fifaActive) return state.liveCounts.fifa > 0 ? POLL.LIVE : POLL.ACTIVE;
  if (state.hasEspnLive) return POLL.LIVE;
  if (state.hasEspnSoon) return POLL.WINDOW;
  const totalLive = Object.values(state.liveCounts).reduce((a, b) => a + b, 0);
  if (totalLive > 0) return POLL.ACTIVE;
  return POLL.IDLE;
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => refresh({ silent: true }), getPollInterval());
}

async function goSport(sportId) {
  if (state.view === 'sport' && sportId === state.selectedSport) return;
  state.selectedSport = sportId;
  state.selectedStandingsTab = 0;
  navigate({ view: 'sport', sport: sportId });
  await refresh();
}

async function goMyTeams() {
  if (state.view === 'my-teams') return;
  navigate({ view: 'my-teams' });
  await refresh();
}

function espnTick() {
  if (state.fifaActive || state.view !== 'sport') return;
  const events = state.scoreboard?.events || [];
  document.querySelectorAll('#scoreboard-grid .game-card[data-event-id]').forEach((card) => {
    const event = events.find((e) => String(e.id) === card.dataset.eventId);
    if (!event) return;
    const status = getEventStatus(event);
    const countdown = card.querySelector(`[data-countdown="${event.id}"]`);
    if (countdown && status.phase === 'upcoming') {
      countdown.textContent = getEspnFootText(event, status);
    }
    if (status.phase === 'live') {
      patchEspnGameCard(card, event, state.selectedSport);
    }
  });
}

function initClock() {
  const tick = () => {
    $('#live-clock').textContent = new Date().toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    espnTick();
  };
  tick();
  state.tickTimer = setInterval(tick, 1000);
}

function initRouting() {
  window.addEventListener('popstate', () => {
    const route = parseHash();
    if (!route) return;
    state.view = route.view;
    if (route.sport) state.selectedSport = route.sport;
    state.selectedStandingsTab = 0;
    updateViewVisibility();
    refresh({ silent: true });
  });

  $('#logo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (hasFavorites()) goMyTeams();
    else goSport(state.selectedSport);
  });
}

async function init() {
  initClock();
  await loadManifest();
  initRouting();
  $('#refresh-btn').addEventListener('click', () => {
    if (state.fifaActive && isFifa(getSport(state.selectedSport))) {
      window.FifaTracker?.refresh();
    } else {
      refresh();
    }
  });

  const route = parseHash();
  if (route) {
    navigate(route, { replace: true });
  } else if (hasFavorites()) {
    navigate({ view: 'my-teams' }, { replace: true });
  } else {
    navigate({ view: 'sport', sport: 'nfl' }, { replace: true });
  }

  await refresh();
}

init();