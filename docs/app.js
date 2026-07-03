const DATA_BASE = 'data';
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_V2 = 'https://site.api.espn.com/apis/v2/sports';
const FIFA_API = 'https://worldcup26.ir/get';

const POLL = { LIVE: 5_000, ACTIVE: 12_000, IDLE: 30_000 };

const state = {
  manifest: null,
  selectedSport: 'nfl',
  scoreboard: null,
  standings: null,
  fifa: { teams: {}, groups: [], games: [] },
  liveCounts: {},
  selectedStandingsTab: 0,
  pollTimer: null,
  tickTimer: null,
  lastFetch: null,
};

const $ = (sel) => document.querySelector(sel);

// ── Data fetching (cache first, API fallback) ────────────────────

async function fetchCached(path) {
  const res = await fetch(`${DATA_BASE}/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
  return res.json();
}

async function fetchEspnScoreboard(sport) {
  const url = `${ESPN_SITE}/${sport.category}/${sport.league}/scoreboard`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

async function fetchEspnStandings(sport) {
  const url = `${ESPN_V2}/${sport.category}/${sport.league}/standings`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

async function fetchFifaEndpoint(endpoint) {
  try {
    const cached = await fetchCached(`fifa/${endpoint}.json`);
    if (cached[endpoint]) return cached;
    if (cached.games || cached.teams || cached.groups) return cached;
    return cached;
  } catch {
    const res = await fetch(`${FIFA_API}/${endpoint}`);
    if (!res.ok) throw new Error(`FIFA HTTP ${res.status}`);
    return res.json();
  }
}

async function loadManifest() {
  try {
    state.manifest = await fetchCached('manifest.json');
  } catch {
    state.manifest = {
      sports: [
        { id: 'nfl', name: 'NFL', category: 'football', league: 'nfl', icon: '🏈', accent: '#D50A0A' },
        { id: 'nba', name: 'NBA', category: 'basketball', league: 'nba', icon: '🏀', accent: '#C8102E' },
        { id: 'mlb', name: 'MLB', category: 'baseball', league: 'mlb', icon: '⚾', accent: '#BF0D3E' },
        { id: 'nhl', name: 'NHL', category: 'hockey', league: 'nhl', icon: '🏒', accent: '#FFB81C' },
        { id: 'mls', name: 'MLS', category: 'soccer', league: 'usa.1', icon: '⚽', accent: '#C8102E' },
        { id: 'fifa', name: 'World Cup 2026', category: 'soccer', league: 'fifa.world', icon: '🌍', source: 'worldcup26', accent: '#00C853' },
      ],
    };
  }
}

function getSport(id) {
  return state.manifest?.sports?.find((s) => s.id === id);
}

function isFifa(sport) {
  return sport?.source === 'worldcup26' || sport?.id === 'fifa';
}

// ── Sport data loaders ───────────────────────────────────────────

async function loadSportData(sportId) {
  const sport = getSport(sportId);
  if (!sport) return;

  if (isFifa(sport)) {
    const [teamsData, groupsData, gamesData] = await Promise.all([
      fetchFifaEndpoint('teams'),
      fetchFifaEndpoint('groups'),
      fetchFifaEndpoint('games'),
    ]);
    state.fifa.teams = Object.fromEntries((teamsData.teams || []).map((t) => [t.id, t]));
    state.fifa.groups = groupsData.groups || [];
    state.fifa.games = gamesData.games || [];
    state.scoreboard = null;
    state.standings = null;
    return;
  }

  const errors = [];
  try {
    state.scoreboard = await fetchCached(`${sportId}/scoreboard.json`);
  } catch (err) {
    errors.push(`cache: ${err.message}`);
    try {
      state.scoreboard = await fetchEspnScoreboard(sport);
    } catch (apiErr) {
      errors.push(`api: ${apiErr.message}`);
      state.scoreboard = { events: [] };
    }
  }

  try {
    state.standings = await fetchCached(`${sportId}/standings.json`);
  } catch (err) {
    errors.push(`standings cache: ${err.message}`);
    try {
      state.standings = await fetchEspnStandings(sport);
    } catch (apiErr) {
      state.standings = { children: [] };
    }
  }
}

async function loadAllLiveCounts() {
  const counts = {};
  await Promise.all(
    (state.manifest?.sports || []).map(async (sport) => {
      try {
        if (isFifa(sport)) {
          const data = await fetchCached('fifa/games.json').catch(() => fetchFifaEndpoint('games'));
          const games = data.games || [];
          counts[sport.id] = games.filter((g) => {
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

// ── Helpers ──────────────────────────────────────────────────────

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  if (type.state === 'in') return { label: type.shortDetail || 'LIVE', cls: 'live' };
  if (type.completed || type.state === 'post') return { label: type.shortDetail || 'Final', cls: 'final' };
  return { label: type.shortDetail || formatTime(event.date), cls: 'scheduled' };
}

function getCompetitors(event) {
  const comps = event.competitions?.[0]?.competitors || [];
  const home = comps.find((c) => c.homeAway === 'home') || comps[0];
  const away = comps.find((c) => c.homeAway === 'away') || comps[1];
  return { home, away, competition: event.competitions?.[0] };
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str ?? '';
  return el.innerHTML;
}

function setAccent(color) {
  document.documentElement.style.setProperty('--accent', color || '#ff2d2d');
  document.documentElement.style.setProperty('--accent-dark', color || '#cc0000');
  document.documentElement.style.setProperty('--accent-glow', `${color || '#ff2d2d'}55`);
}

// ── Render: navigation ───────────────────────────────────────────

function renderSportNav() {
  const nav = $('#sport-nav');
  nav.innerHTML = (state.manifest?.sports || []).map((sport) => {
    const live = state.liveCounts[sport.id] || 0;
    const active = sport.id === state.selectedSport ? 'active' : '';
    const badge = live > 0 ? `<span class="badge">${live}</span>` : '';
    return `<a href="#${sport.id}" class="sport-link ${active}" data-sport="${sport.id}">${sport.icon || ''} ${esc(sport.shortName || sport.name)} ${badge}</a>`;
  }).join('');

  nav.querySelectorAll('.sport-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      selectSport(link.dataset.sport);
    });
  });
}

function renderSportCards() {
  const grid = $('#sport-cards');
  grid.innerHTML = (state.manifest?.sports || []).map((sport) => {
    const live = state.liveCounts[sport.id] || 0;
    const active = sport.id === state.selectedSport ? 'active' : '';
    const meta = live > 0 ? `${live} live now` : 'View scores';
    return `
      <div class="sport-card ${active}" data-sport="${sport.id}" style="--card-accent:${sport.accent || '#ff2d2d'}">
        <div class="sport-card-icon">${sport.icon || '🏆'}</div>
        <div class="sport-card-name">${esc(sport.name)}</div>
        <div class="sport-card-meta">${meta}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.sport-card').forEach((card) => {
    card.addEventListener('click', () => selectSport(card.dataset.sport));
  });
}

function renderLiveBanner() {
  const banner = $('#live-banner');
  const inner = $('#live-banner-matches');
  const items = [];

  (state.manifest?.sports || []).forEach((sport) => {
    if (isFifa(sport) && sport.id === state.selectedSport) {
      state.fifa.games.filter((g) => {
        const elapsed = String(g.time_elapsed || '').toLowerCase();
        return g.finished !== 'TRUE' && !['finished', 'ft', ''].includes(elapsed);
      }).forEach((g) => {
        items.push(`<span class="ticker-item"><span class="ticker-live">LIVE</span> ${esc(g.home_team_name_en)} ${g.home_score}-${g.away_score} ${esc(g.away_team_name_en)}</span>`);
      });
      return;
    }
    if (sport.id !== state.selectedSport) return;
    (state.scoreboard?.events || []).filter((e) => e.status?.type?.state === 'in').forEach((e) => {
      const { home, away } = getCompetitors(e);
      items.push(`<span class="ticker-item"><span class="ticker-live">LIVE</span> ${esc(away?.team?.abbreviation)} ${away?.score}-${home?.score} ${esc(home?.team?.abbreviation)}</span>`);
    });
  });

  if (items.length) {
    inner.innerHTML = items.join('');
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderLiveIndicator() {
  const sport = getSport(state.selectedSport);
  const live = state.liveCounts[state.selectedSport] || 0;
  const pill = $('#live-indicator');
  const label = $('#live-count-label');
  if (live > 0) {
    pill.hidden = false;
    label.textContent = `${live} LIVE`;
  } else {
    pill.hidden = true;
  }
}

// ── Render: ESPN scoreboard ──────────────────────────────────────

function renderEspnScoreboard() {
  const grid = $('#scoreboard-grid');
  const events = state.scoreboard?.events || [];
  const today = events.filter((e) => isToday(e.date));
  const live = today.filter((e) => e.status?.type?.state === 'in');
  const rest = today.filter((e) => e.status?.type?.state !== 'in');

  $('#today-meta').textContent = today.length
    ? `${live.length} live · ${today.length} games today`
    : `${events.length} games on the schedule`;

  const show = [...live, ...rest].slice(0, 24);
  if (!show.length) {
    grid.innerHTML = '<div class="empty-state">No games scheduled for today. Check Upcoming for the full schedule.</div>';
    return;
  }

  grid.innerHTML = show.map((event) => {
    const { home, away, competition } = getCompetitors(event);
    const status = getEventStatus(event);
    const isLive = status.cls === 'live';
    const isFinal = status.cls === 'final';
    const homeScore = Number(home?.score ?? 0);
    const awayScore = Number(away?.score ?? 0);
    const homeWin = isFinal && homeScore > awayScore;
    const awayWin = isFinal && awayScore > homeScore;

    return `
      <article class="game-card ${isLive ? 'live' : ''}">
        <div class="game-card-head">
          <span>${esc(competition?.type?.abbreviation || competition?.notes?.[0]?.headline || getSport(state.selectedSport)?.name || '')}</span>
          <span class="game-status ${status.cls}">${esc(status.label)}</span>
        </div>
        <div class="game-card-body">
          ${renderTeamRow(away, awayWin, awayWin ? '' : 'loser')}
          ${renderTeamRow(home, homeWin, homeWin ? '' : 'loser')}
        </div>
        <div class="game-card-foot">
          <span>${esc(competition?.venue?.fullName || '')}</span>
          <a href="${esc(event.links?.[0]?.href || 'https://www.espn.com')}" target="_blank" rel="noopener">Details</a>
        </div>
      </article>`;
  }).join('');
}

function renderTeamRow(comp, isWinner, extraCls) {
  if (!comp) return '';
  const cls = [isWinner ? 'winner' : '', extraCls].filter(Boolean).join(' ');
  const logo = comp.team?.logo
    ? `<img class="team-logo" src="${esc(comp.team.logo)}" alt="" loading="lazy">`
    : '';
  return `
    <div class="team-row ${cls}">
      ${logo}
      <span class="team-name">${esc(comp.team?.displayName || comp.team?.name || 'TBD')}</span>
      <span class="team-score">${esc(comp.score ?? '-')}</span>
    </div>`;
}

// ── Render: FIFA scoreboard ──────────────────────────────────────

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

function renderFifaScoreboard() {
  const grid = $('#scoreboard-grid');
  const games = state.fifa.games || [];
  const today = games.filter((g) => isToday(parseFifaDate(g.local_date)));
  const live = today.filter(isFifaLive);
  const rest = today.filter((g) => !isFifaLive(g));

  $('#today-meta').textContent = today.length
    ? `${live.length} live · ${today.length} matches today`
    : `${games.length} matches in tournament`;

  const show = [...live, ...rest].slice(0, 24);
  if (!show.length) {
    grid.innerHTML = '<div class="empty-state">No World Cup matches today.</div>';
    return;
  }

  grid.innerHTML = show.map((g) => {
    const home = state.fifa.teams[g.home_team_id] || {};
    const away = state.fifa.teams[g.away_team_id] || {};
    const live = isFifaLive(g);
    const isFinal = g.finished === 'TRUE';
    const homeScore = Number(g.home_score || 0);
    const awayScore = Number(g.away_score || 0);

    return `
      <article class="game-card ${live ? 'live' : ''}">
        <div class="game-card-head">
          <span>Group ${esc(g.group)} · MD${esc(g.matchday)}</span>
          <span class="game-status ${live ? 'live' : isFinal ? 'final' : 'scheduled'}">${live ? esc(g.time_elapsed || 'LIVE') : isFinal ? 'FT' : formatTime(parseFifaDate(g.local_date))}</span>
        </div>
        <div class="game-card-body">
          ${renderFifaTeamRow(away, awayScore, awayScore > homeScore && isFinal)}
          ${renderFifaTeamRow(home, homeScore, homeScore > awayScore && isFinal)}
        </div>
        <div class="game-card-foot">
          <span>${esc(g.type)} stage</span>
          <span>${formatTime(parseFifaDate(g.local_date))}</span>
        </div>
      </article>`;
  }).join('');
}

function renderFifaTeamRow(team, score, isWinner) {
  const flag = team.flag
    ? `<img class="team-flag" src="${esc(team.flag)}" alt="" loading="lazy">`
    : '';
  return `
    <div class="team-row ${isWinner ? 'winner' : ''}">
      ${flag}
      <span class="team-name">${esc(team.name_en || 'TBD')}</span>
      <span class="team-score">${esc(score)}</span>
    </div>`;
}

// ── Render: standings ────────────────────────────────────────────

function getStandingsGroups() {
  const children = state.standings?.children || [];
  return children.filter((c) => c.standings?.entries?.length);
}

function renderStandingsTabs() {
  const tabs = $('#standings-tabs');
  const groups = getStandingsGroups();

  if (!groups.length) {
    tabs.innerHTML = '';
    return;
  }

  tabs.innerHTML = groups.map((g, i) => {
    const active = i === state.selectedStandingsTab ? 'active' : '';
    return `<button class="group-tab ${active}" data-tab="${i}" role="tab">${esc(g.shortName || g.name)}</button>`;
  }).join('');

  tabs.querySelectorAll('.group-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedStandingsTab = Number(btn.dataset.tab);
      renderStandingsTabs();
      renderStandingsTable();
    });
  });
}

function renderStandingsTable() {
  const layout = $('#standings-layout');
  const groups = getStandingsGroups();

  if (!groups.length) {
    layout.innerHTML = '<div class="empty-state">Standings not available for this league.</div>';
    return;
  }

  const group = groups[state.selectedStandingsTab] || groups[0];
  const entries = [...(group.standings?.entries || [])].sort(
    (a, b) => (a.stats?.find((s) => s.name === 'rank')?.value ?? 99) - (b.stats?.find((s) => s.name === 'rank')?.value ?? 99),
  );

  const statNames = ['wins', 'losses', 'ties', 'winPercent', 'pointsFor', 'pointsAgainst', 'differential'];
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
            return `<tr>
              <td class="rank">${esc(stats.rank ?? '')}</td>
              <td><div class="team-cell">${logo} ${esc(team.displayName || team.name)}</div></td>
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
}

function renderFifaStandings() {
  const layout = $('#standings-layout');
  const tabs = $('#standings-tabs');
  tabs.innerHTML = '';

  const groups = [...(state.fifa.groups || [])].sort((a, b) => a.name.localeCompare(b.name));

  if (!groups.length) {
    layout.innerHTML = '<div class="empty-state">Group standings not available.</div>';
    return;
  }

  layout.innerHTML = `<div class="fifa-groups">${groups.map((group) => {
    const rows = [...(group.teams || [])].sort((a, b) => Number(b.pts) - Number(a.pts));
    return `
      <div class="fifa-group-card">
        <div class="fifa-group-head">Group ${esc(group.name)}</div>
        <table class="standings-table">
          <thead><tr><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>
            ${rows.map((row) => {
              const team = state.fifa.teams[row.team_id] || {};
              const flag = team.flag ? `<img class="team-flag" src="${esc(team.flag)}" alt="">` : '';
              return `<tr>
                <td><div class="team-cell">${flag} ${esc(team.name_en || row.team_id)}</div></td>
                <td class="num">${esc(row.mp)}</td>
                <td class="num">${esc(row.w)}</td>
                <td class="num">${esc(row.d)}</td>
                <td class="num">${esc(row.l)}</td>
                <td class="num">${esc(row.gd)}</td>
                <td class="num"><strong>${esc(row.pts)}</strong></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }).join('')}</div>`;
}

// ── Render: schedule ─────────────────────────────────────────────

function renderEspnSchedule() {
  const list = $('#schedule-list');
  const events = (state.scoreboard?.events || [])
    .filter((e) => e.status?.type?.state === 'pre' || e.status?.type?.name === 'STATUS_SCHEDULED')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 12);

  $('#schedule-meta').textContent = events.length ? 'Next games on the schedule' : 'No upcoming games found';

  if (!events.length) {
    list.innerHTML = '<div class="empty-state">No upcoming games in the current scoreboard window.</div>';
    return;
  }

  list.innerHTML = events.map((event) => {
    const { home, away, competition } = getCompetitors(event);
    return `
      <div class="schedule-row">
        <span class="schedule-time">${formatDate(event.date)}<br>${formatTime(event.date)}</span>
        <span class="schedule-match">${esc(away?.team?.displayName)} @ ${esc(home?.team?.displayName)}</span>
        <span class="schedule-venue">${esc(competition?.venue?.fullName || '')}</span>
      </div>`;
  }).join('');
}

function renderFifaSchedule() {
  const list = $('#schedule-list');
  const upcoming = (state.fifa.games || [])
    .filter((g) => g.finished !== 'TRUE')
    .sort((a, b) => parseFifaDate(a.local_date) - parseFifaDate(b.local_date))
    .slice(0, 12);

  $('#schedule-meta').textContent = `${upcoming.length} matches remaining`;

  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-state">Tournament complete — no upcoming matches.</div>';
    return;
  }

  list.innerHTML = upcoming.map((g) => {
    const home = state.fifa.teams[g.home_team_id]?.name_en || 'TBD';
    const away = state.fifa.teams[g.away_team_id]?.name_en || 'TBD';
    const kickoff = parseFifaDate(g.local_date);
    return `
      <div class="schedule-row">
        <span class="schedule-time">${formatDate(kickoff)}<br>${formatTime(kickoff)}</span>
        <span class="schedule-match">${esc(away)} vs ${esc(home)} <span style="color:var(--dim)">· Grp ${esc(g.group)}</span></span>
        <span class="schedule-venue">${esc(g.type)}</span>
      </div>`;
  }).join('');
}

// ── Main render / refresh ────────────────────────────────────────

function renderAll() {
  const sport = getSport(state.selectedSport);
  if (sport?.accent) setAccent(sport.accent);

  renderSportNav();
  renderSportCards();
  renderLiveIndicator();
  renderLiveBanner();

  if (isFifa(sport)) {
    renderFifaScoreboard();
    renderFifaStandings();
    renderFifaSchedule();
  } else {
    renderEspnScoreboard();
    renderStandingsTabs();
    renderStandingsTable();
    renderEspnSchedule();
  }
}

async function refresh({ silent = false } = {}) {
  if (!silent) {
    $('#scoreboard-grid').innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading games...</p></div>';
    $('#standings-layout').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    await Promise.all([loadSportData(state.selectedSport), loadAllLiveCounts()]);
    state.lastFetch = new Date();
    renderAll();
    schedulePoll();
  } catch (err) {
    console.error(err);
    $('#scoreboard-grid').innerHTML = `<div class="empty-state">Failed to load data: ${esc(err.message)}</div>`;
  }
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const totalLive = Object.values(state.liveCounts).reduce((a, b) => a + b, 0);
  const sportLive = state.liveCounts[state.selectedSport] || 0;
  const delay = sportLive > 0 ? POLL.LIVE : totalLive > 0 ? POLL.ACTIVE : POLL.IDLE;
  state.pollTimer = setTimeout(() => refresh({ silent: true }), delay);
}

async function selectSport(sportId) {
  if (sportId === state.selectedSport) return;
  state.selectedSport = sportId;
  state.selectedStandingsTab = 0;
  history.replaceState(null, '', `#${sportId}`);
  await refresh();
  document.getElementById('live')?.scrollIntoView({ behavior: 'smooth' });
}

function initClock() {
  const tick = () => {
    $('#live-clock').textContent = new Date().toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };
  tick();
  state.tickTimer = setInterval(tick, 1000);
}

function initHashRouting() {
  const hash = location.hash.replace('#', '');
  if (hash && getSport(hash)) state.selectedSport = hash;
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (id && getSport(id)) selectSport(id);
  });
}

async function init() {
  initClock();
  await loadManifest();
  initHashRouting();
  $('#refresh-btn').addEventListener('click', () => refresh());
  await refresh();
}

init();