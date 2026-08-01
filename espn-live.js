(function () {
'use strict';

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports';

const WATCH_HUBS = {
  ESPN: { label: 'ESPN', url: 'https://www.espn.com/watch/' },
  'ESPN+': { label: 'ESPN+', url: 'https://plus.espn.com/' },
  'ESPN2': { label: 'ESPN2', url: 'https://www.espn.com/watch/' },
  'ESPN3': { label: 'ESPN3', url: 'https://www.espn.com/watch/' },
  ABC: { label: 'ABC', url: 'https://abc.com/watch-live/abc' },
  NBC: { label: 'NBC', url: 'https://www.nbc.com/live' },
  Peacock: { label: 'Peacock', url: 'https://www.peacocktv.com/sports/live' },
  FOX: { label: 'FOX', url: 'https://www.fox.com/live' },
  FS1: { label: 'FS1', url: 'https://www.foxsports.com/live' },
  'FOX One': { label: 'FOX One', url: 'https://www.fox.com/live' },
  CBS: { label: 'CBS', url: 'https://www.cbs.com/live-tv/' },
  'CBS Sports Network': { label: 'CBS Sports Network', url: 'https://www.cbssports.com/watch/' },
  'NFL Network': { label: 'NFL Network', url: 'https://www.nfl.com/network/' },
  'NFL+': { label: 'NFL+', url: 'https://www.nfl.com/plus/' },
  'MLB.TV': { label: 'MLB.TV', url: 'https://www.mlb.com/tv' },
  'NBA League Pass': { label: 'NBA League Pass', url: 'https://www.nba.com/watch/league-pass' },
  TNT: { label: 'TNT', url: 'https://www.tntdrama.com/watchtnt' },
  TBS: { label: 'TBS', url: 'https://www.tbs.com/watchtbs' },
  'Apple TV': { label: 'Apple TV', url: 'https://tv.apple.com/' },
  'MLS Season Pass': { label: 'MLS Season Pass', url: 'https://www.apple.com/apple-tv-plus/' },
  'NHL Network': { label: 'NHL Network', url: 'https://www.nhl.com/network' },
  Tele: { label: 'Telemundo', url: 'https://www.telemundo.com/shows/deportes' },
  Universo: { label: 'Universo', url: 'https://www.telemundo.com/shows/deportes' },
};

const FREE_BY_SPORT = {
  mlb: [
    { label: 'MLB.TV Free Game', url: 'https://www.mlb.com/tv', note: 'Daily free game of the day on MLB.TV' },
    { label: 'Tubi MLB', url: 'https://tubitv.com/live', note: 'Free live sports on Tubi' },
  ],
  nfl: [
    { label: 'NFL+ Free', url: 'https://www.nfl.com/plus/', note: 'Free live local & primetime games on NFL+' },
    { label: 'Tubi NFL', url: 'https://tubitv.com/live', note: 'Free sports streams on Tubi' },
  ],
  nba: [
    { label: 'NBA League Pass Free Preview', url: 'https://www.nba.com/watch/league-pass', note: 'Select free games on NBA.com' },
    { label: 'Pluto TV Sports', url: 'https://pluto.tv/live-tv/pluto-tv-sports', note: 'Free sports channels' },
  ],
  nhl: [
    { label: 'ESPN Free Games', url: 'https://www.espn.com/watch/', note: 'Select NHL games stream free on ESPN' },
    { label: 'Pluto TV Sports', url: 'https://pluto.tv/live-tv/pluto-tv-sports', note: 'Free sports channels' },
  ],
  mls: [
    { label: 'MLS Free on Apple TV', url: 'https://tv.apple.com/', note: 'Select MLS matches stream free' },
    { label: 'FIFA+', url: 'https://www.plus.fifa.com/en/', note: 'Free soccer streams on FIFA+' },
  ],
  ncaaf: [
    { label: 'Pluto TV Sports', url: 'https://pluto.tv/live-tv/pluto-tv-sports', note: 'Free college sports channels' },
    { label: 'Tubi', url: 'https://tubitv.com/live', note: 'Free live sports on Tubi' },
  ],
  wnba: [
    { label: 'WNBA Free Streams', url: 'https://www.wnba.com/watch', note: 'Select games stream free on WNBA.com' },
    { label: 'Pluto TV Sports', url: 'https://pluto.tv/live-tv/pluto-tv-sports', note: 'Free sports channels' },
  ],
};

const DEFAULT_FREE = [
  { label: 'Pluto TV Sports', url: 'https://pluto.tv/live-tv/pluto-tv-sports', note: 'Free sports channels' },
  { label: 'Tubi Live', url: 'https://tubitv.com/live', note: 'Free live sports on Tubi' },
];

const state = {
  summaries: {},
  summaryFetchedAt: {},
  sportId: null,
  bridge: null,
};

const $ = (sel, root = document) => root.querySelector(sel);

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function configure(bridge) {
  state.bridge = bridge;
}

function clearSummaries() {
  state.summaries = {};
  state.summaryFetchedAt = {};
}

function getPhase(event) {
  const type = event.status?.type || {};
  if (type.state === 'in') return 'live';
  if (type.completed || type.state === 'post') return 'finished';
  return 'upcoming';
}

function parseClock(displayClock) {
  if (!displayClock) return 0;
  const parts = String(displayClock).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function getCompetitionStatus(event, summary) {
  return summary?.header?.competitions?.[0]?.status
    || event.competitions?.[0]?.status
    || event.status
    || {};
}

function getPeriodLabel(event, summary, sportId) {
  const st = getCompetitionStatus(event, summary);
  const detail = st.type?.shortDetail || st.type?.detail || event.status?.type?.shortDetail || '';
  if (detail) return detail;
  const period = st.period ?? event.status?.period;
  if (sportId === 'mlb' && period) return `Inning ${period}`;
  if (period) return `Period ${period}`;
  return 'Live';
}

function getClockLabel(event, summary, sportId) {
  const st = getCompetitionStatus(event, summary);
  if (st.displayClock && st.displayClock !== '0.0' && st.displayClock !== '0:00') {
    return st.displayClock;
  }
  if (sportId === 'mlb' && summary?.situation) {
    const { balls = 0, strikes = 0, outs = 0 } = summary.situation;
    return `${balls}-${strikes}, ${outs} out${outs === 1 ? '' : 's'}`;
  }
  return st.type?.detail || event.status?.type?.detail || 'LIVE';
}

function getProgressPercent(event, summary, sportId) {
  const st = getCompetitionStatus(event, summary);
  const period = st.period ?? event.status?.period ?? 1;
  const clockSec = parseClock(st.displayClock);

  switch (sportId) {
    case 'mlb': {
      const inning = Math.max(1, period);
      const half = (st.periodPrefix || st.type?.detail || '').toLowerCase().includes('bot') ? 1 : 0;
      return Math.min(((inning - 1) * 2 + half + 0.5) / 18 * 100, 100);
    }
    case 'nba':
    case 'wnba': {
      const q = Math.max(1, Math.min(4, period));
      const qLen = 12 * 60;
      const elapsed = Math.max(0, qLen - clockSec);
      return Math.min(((q - 1) / 4 + elapsed / qLen / 4) * 100, 100);
    }
    case 'nfl':
    case 'ncaaf': {
      const q = Math.max(1, Math.min(4, period));
      const qLen = 15 * 60;
      const elapsed = Math.max(0, qLen - clockSec);
      return Math.min(((q - 1) / 4 + elapsed / qLen / 4) * 100, 100);
    }
    case 'nhl': {
      const p = Math.max(1, Math.min(3, period));
      const pLen = 20 * 60;
      const elapsed = Math.max(0, pLen - clockSec);
      return Math.min(((p - 1) / 3 + elapsed / pLen / 3) * 100, 100);
    }
    case 'mls': {
      const mins = parseClock(st.displayClock) / 60 || period * 22;
      return Math.min((mins / 90) * 100, 100);
    }
    default:
      return Math.min(period * 25, 100);
  }
}

function getSituationHtml(event, summary, sportId) {
  if (sportId !== 'mlb' || getPhase(event) !== 'live') return '';
  const sit = summary?.situation;
  if (!sit) return '';
  const on = [
    sit.onFirst ? '1B' : null,
    sit.onSecond ? '2B' : null,
    sit.onThird ? '3B' : null,
  ].filter(Boolean);
  const bases = on.length ? on.join(' · ') : 'Bases empty';
  const lastPlay = sit.lastPlay?.text;
  return `
    <div class="se-situation" data-situation="${event.id}">
      <span class="se-count">${esc(getClockLabel(event, summary, sportId))}</span>
      <span class="se-bases">${esc(bases)}</span>
      ${lastPlay ? `<span class="se-last-play">${esc(lastPlay)}</span>` : ''}
    </div>`;
}

function parseBroadcasts(event, summary) {
  const names = new Set();
  const comp = summary?.header?.competitions?.[0] || event.competitions?.[0];
  (comp?.broadcasts || []).forEach((b) => {
    if (b.media?.shortName) names.add(b.media.shortName);
    if (b.names) b.names.forEach((n) => names.add(n));
  });
  (comp?.geoBroadcasts || []).forEach((g) => {
    if (g.media?.shortName) names.add(g.media.shortName);
  });
  (summary?.broadcasts || []).forEach((b) => {
    if (b.media?.shortName) names.add(b.media.shortName);
    if (b.station) names.add(b.station);
  });
  (event.competitions?.[0]?.broadcasts || []).forEach((b) => {
    if (b.names) b.names.forEach((n) => names.add(n));
  });
  return [...names];
}

function getWatchOptions(event, summary, sportId) {
  const broadcasts = parseBroadcasts(event, summary);
  const paid = [];
  const seen = new Set();

  broadcasts.forEach((name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const hub = WATCH_HUBS[name];
    if (hub) {
      paid.push({ ...hub, primary: ['FOX', 'NBC', 'ABC', 'ESPN', 'CBS', 'MLB.TV'].includes(name) });
    } else {
      paid.push({ label: name, url: `https://www.google.com/search?q=${encodeURIComponent(name + ' live stream')}` });
    }
  });

  const sport = state.bridge?.getSport?.(sportId);
  const gamecastUrl = event.links?.find((l) => l.rel?.includes('gamecast'))?.href
    || event.links?.[0]?.href
    || `https://www.espn.com/${sport?.league || sportId}/game/_/gameId/${event.id}`;

  paid.push({
    label: 'ESPN Gamecast',
    url: gamecastUrl,
    tracker: true,
  });

  const free = FREE_BY_SPORT[sportId] || DEFAULT_FREE;
  return { paid, free };
}

function watchFingerprint(event, summary, sportId, phase) {
  return JSON.stringify({ phase, options: getWatchOptions(event, summary, sportId) });
}

function renderWatchBar(event, summary, sportId, phase) {
  if (phase !== 'live' && phase !== 'upcoming') return '';
  const opts = getWatchOptions(event, summary, sportId);
  if (!opts.paid.length && !opts.free.length) return '';

  const paidBtns = opts.paid.map((o) => `
    <a class="watch-btn ${o.tracker ? 'tracker' : ''} ${o.primary ? 'primary' : ''}"
       href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">
      ${o.tracker ? 'Live tracker · ' : ''}${esc(o.label)}
    </a>`).join('');

  const freeBtns = opts.free.map((o) => `
    <a class="watch-btn free" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer"
       title="${esc(o.note)}">
      ${esc(o.label)} <span class="free-tag">FREE</span>
    </a>`).join('');

  const liveLabel = phase === 'live' ? 'Watch Live' : 'Where to Watch';
  const fp = watchFingerprint(event, summary, sportId, phase);

  return `
    <div class="watch-bar" data-watch="${event.id}" data-watch-fp="${fp}">
      <div class="watch-bar-head">
        <span class="watch-title">▶ ${liveLabel}</span>
        <span class="watch-note">Broadcast &amp; free streaming options</span>
      </div>
      <div class="watch-btns">${paidBtns}${freeBtns}</div>
    </div>`;
}

function syncWatchBar(card, event, summary, sportId, phase) {
  const el = card.querySelector(`[data-watch="${event.id}"]`);
  if (phase !== 'live' && phase !== 'upcoming') {
    el?.remove();
    return;
  }
  const html = renderWatchBar(event, summary, sportId, phase);
  if (!html) {
    el?.remove();
    return;
  }
  const fp = watchFingerprint(event, summary, sportId, phase);
  if (el?.dataset.watchFp === fp) return;
  if (!el) {
    card.querySelector('.se-card-top')?.insertAdjacentHTML('afterend', html);
    return;
  }
  el.outerHTML = html;
}

function renderLiveTracker(event, summary, sportId) {
  const period = getPeriodLabel(event, summary, sportId);
  const clock = getClockLabel(event, summary, sportId);
  const pct = getProgressPercent(event, summary, sportId);
  const situation = getSituationHtml(event, summary, sportId);
  return `
    <div class="se-tracker" data-tracker="${event.id}">
      <div class="se-track-top">
        <span class="se-period" data-live-period="${event.id}">${esc(period)}</span>
        <span class="se-match-clock" data-live-minute="${event.id}">${esc(clock)}</span>
      </div>
      <div class="se-progress">
        <div class="se-progress-fill" data-live-progress="${event.id}" style="width:${pct}%"></div>
      </div>
      ${situation}
    </div>`;
}

function syncTracker(card, event, summary, sportId, phase) {
  const tracker = card.querySelector(`[data-tracker="${event.id}"]`);
  if (phase !== 'live') {
    tracker?.remove();
    return;
  }
  if (!tracker) {
    card.querySelector('.watch-bar, .se-card-top')?.insertAdjacentHTML('afterend', renderLiveTracker(event, summary, sportId));
    return;
  }
  const periodEl = card.querySelector(`[data-live-period="${event.id}"]`);
  const minuteEl = card.querySelector(`[data-live-minute="${event.id}"]`);
  const progressEl = card.querySelector(`[data-live-progress="${event.id}"]`);
  if (periodEl) periodEl.textContent = getPeriodLabel(event, summary, sportId);
  if (minuteEl) minuteEl.textContent = getClockLabel(event, summary, sportId);
  if (progressEl) progressEl.style.width = `${getProgressPercent(event, summary, sportId)}%`;

  const sitEl = card.querySelector(`[data-situation="${event.id}"]`);
  const sitHtml = getSituationHtml(event, summary, sportId);
  if (sitHtml && !sitEl) {
    tracker.insertAdjacentHTML('beforeend', sitHtml);
  } else if (sitEl && sitHtml) {
    const tmp = document.createElement('div');
    tmp.innerHTML = sitHtml;
    const next = tmp.firstElementChild;
    if (sitEl.outerHTML !== next.outerHTML) sitEl.replaceWith(next);
  } else if (!sitHtml) {
    sitEl?.remove();
  }
}

function getHomeTeamId(event, summary) {
  const comps = summary?.header?.competitions?.[0]?.competitors
    || event.competitions?.[0]?.competitors
    || [];
  return comps.find((c) => c.homeAway === 'home')?.team?.id
    || comps.find((c) => c.homeAway === 'home')?.id;
}

function parseScoringPlays(event, summary, sportId) {
  const homeId = getHomeTeamId(event, summary);
  const raw = summary?.scoringPlays
    || summary?.plays?.filter((p) => p.scoringPlay)
    || summary?.keyEvents?.filter((e) => e.scoringPlay)
    || [];

  return raw.map((play) => {
    const teamId = play.team?.id;
    const side = String(teamId) === String(homeId) ? 'home' : 'away';
    const athlete = play.participants?.find((p) => p.type === 'scorer' || p.type === 'batter')
      || play.participants?.find((p) => p.athlete?.displayName)
      || play.participants?.[0];
    const player = athlete?.athlete?.displayName || athlete?.athlete?.shortName || '';
    const period = play.period?.displayValue || play.clock?.displayValue || '';
    const scoreText = play.awayScore != null && play.homeScore != null
      ? `${play.awayScore}-${play.homeScore}`
      : '';
    return {
      id: play.id,
      side,
      player: player || play.text?.split(' ')[0] || 'Score',
      period,
      text: play.text || play.type?.text || 'Scoring play',
      scoreText,
      type: (play.type?.text || '').toLowerCase().includes('touchdown') ? 'td'
        : (play.type?.text || '').toLowerCase().includes('home run') ? 'hr'
        : 'score',
    };
  });
}

function playsFingerprint(plays) {
  return plays.map((p) => `${p.id}|${p.side}|${p.text}|${p.scoreText}`).join(';');
}

function playBadge(type, sportId) {
  if (type === 'td') return 'TD';
  if (type === 'hr') return 'HR';
  if (sportId === 'mls') return 'GOAL';
  return 'PTS';
}

function renderPlayRow(play, sportId) {
  return `
    <div class="goal-event ${play.side}">
      <span class="ge-min">${esc(play.period)}</span>
      <div class="ge-body">
        <span class="ge-scorer">${esc(play.player)}</span>
        <span class="ge-detail">${esc(play.text)}${play.scoreText ? ` · <strong>${esc(play.scoreText)}</strong>` : ''}</span>
      </div>
      <div class="ge-meta">
        <span class="ge-badge ${play.type}">${playBadge(play.type, sportId)}</span>
      </div>
    </div>`;
}

function renderScoringPlays(event, summary, sportId, live = false) {
  const plays = parseScoringPlays(event, summary, sportId);
  if (!plays.length) return '';
  const fp = playsFingerprint(plays);
  const cls = live ? 'goal-events live-goals' : 'goal-events';
  const label = sportId === 'mls' ? 'Goal Events' : 'Scoring Plays';
  return `
    <div class="${cls}" data-goals="${event.id}" data-goals-fp="${fp}" data-goals-count="${plays.length}">
      <div class="goal-events-head">
        <span>${label}</span>
        <span class="goal-count">${plays.length}</span>
      </div>
      ${plays.map((p) => renderPlayRow(p, sportId)).join('')}
    </div>`;
}

function syncScoringPlays(card, event, summary, sportId, live = false) {
  const plays = parseScoringPlays(event, summary, sportId);
  const fp = playsFingerprint(plays);
  let el = card.querySelector(`[data-goals="${event.id}"]`);

  if (!plays.length) {
    el?.remove();
    return;
  }

  if (el?.dataset.goalsFp === fp) return;

  if (!el) {
    card.querySelector('.se-foot')?.insertAdjacentHTML('beforebegin', renderScoringPlays(event, summary, sportId, live));
    return;
  }

  el.outerHTML = renderScoringPlays(event, summary, sportId, live);
}

function parseHighlights(summary) {
  return (summary?.videos || []).slice(0, 8).map((v) => ({
    id: v.id,
    title: v.headline || v.description || 'Highlight',
    thumb: v.thumbnail,
    webUrl: v.links?.web?.href,
    mp4: v.links?.source?.href,
    duration: v.duration,
  }));
}

function highlightsFingerprint(clips) {
  return clips.map((c) => `${c.id}|${c.title}`).join(';');
}

function formatDuration(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function renderHighlightClip(clip) {
  if (clip.mp4) {
    return `
      <div class="ge-clip">
        <button type="button" class="ge-clip-btn" data-mp4="${esc(clip.mp4)}"
                data-title="${esc(clip.title)}"
                title="${esc(clip.title)}" aria-label="Play highlight">
          <img class="ge-clip-thumb" src="${esc(clip.thumb)}" alt="" loading="lazy">
          <span class="ge-clip-play">▶</span>
        </button>
      </div>`;
  }
  if (clip.webUrl) {
    return `
      <a class="ge-clip-link" href="${esc(clip.webUrl)}" target="_blank" rel="noopener noreferrer"
         title="${esc(clip.title)}">
        <span class="ge-clip-play">▶</span> Clip
      </a>`;
  }
  return '';
}

function renderHighlights(event, summary) {
  const clips = parseHighlights(summary);
  if (!clips.length) return '';
  const fp = highlightsFingerprint(clips);
  return `
    <div class="highlight-events" data-highlights="${event.id}" data-highlights-fp="${fp}">
      <div class="goal-events-head">
        <span>Highlights</span>
        <span class="goal-count">${clips.length}</span>
      </div>
      <div class="highlight-grid">
        ${clips.map((c) => `
          <div class="highlight-item">
            ${renderHighlightClip(c)}
            <span class="highlight-title">${esc(c.title)}</span>
            ${c.duration ? `<span class="highlight-dur">${formatDuration(c.duration)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>`;
}

function syncHighlights(card, event, summary) {
  const clips = parseHighlights(summary);
  const fp = highlightsFingerprint(clips);
  let el = card.querySelector(`[data-highlights="${event.id}"]`);
  if (!clips.length) {
    el?.remove();
    return;
  }
  if (el?.dataset.highlightsFp === fp) return;
  if (!el) {
    card.querySelector(`[data-goals="${event.id}"], .se-foot`)?.insertAdjacentHTML('beforebegin', renderHighlights(event, summary));
    return;
  }
  el.outerHTML = renderHighlights(event, summary);
}

function getOddsTone(val) {
  if (!val) return '';
  const n = Number(String(val).replace('+', ''));
  if (Number.isNaN(n)) return '';
  if (n < 0) return 'fav';
  if (n > 0) return 'dog';
  return '';
}

function oddsLaymanTitle(val) {
  const n = Number(String(val).replace('+', ''));
  if (Number.isNaN(n)) return 'Betting odds';
  if (n < 0) return `Favorite — bet $${Math.abs(n)} to win $100`;
  return `Underdog — bet $100 to win $${n}`;
}

function renderMlOdds(event, competition, side, phase) {
  if (phase === 'finished') return '';
  const odds = state.bridge?.getEventOdds?.(event, competition);
  if (!odds) return '';
  const val = side === 'home' ? odds.moneyline.home : odds.moneyline.away;
  if (!val) return '';
  const tone = getOddsTone(val);
  const liveCls = phase === 'live' ? ' live-line' : '';
  const attr = side === 'home' ? 'home' : 'away';
  return `<span class="se-ml ${tone}${liveCls}" data-${attr}-ml="${event.id}" title="${esc(oddsLaymanTitle(val))}">${esc(val)}</span>`;
}

function syncMlOdds(card, event, competition, phase) {
  ['home', 'away'].forEach((side) => {
    const el = card.querySelector(`[data-${side}-ml="${event.id}"]`);
    const html = renderMlOdds(event, competition, side, phase);
    if (!html) {
      el?.remove();
      return;
    }
    if (!el) {
      const stack = card.querySelector(`.se-side.${side === 'home' ? 'home-side' : 'away-side'} .se-score-stack`);
      stack?.insertAdjacentHTML('beforeend', html);
      return;
    }
    const odds = state.bridge?.getEventOdds?.(event, competition);
    const val = side === 'home' ? odds?.moneyline?.home : odds?.moneyline?.away;
    if (val && el.textContent !== val) el.textContent = val;
  });
}

function teamLogo(comp) {
  const href = comp?.team?.logos?.[0]?.href || comp?.team?.logo;
  if (href) return `<img src="${esc(href)}" alt="" loading="lazy" class="se-flag">`;
  return '<span class="ph-flag"></span>';
}

function getEventLabel(event, sportId) {
  const sport = state.bridge?.getSport?.(sportId);
  const comp = event.competitions?.[0];
  const note = comp?.type?.abbreviation || comp?.notes?.[0]?.headline || comp?.venue?.fullName || '';
  return `${sport?.shortName || ''}${note ? ` · ${note}` : ''}`.trim();
}

function getFootText(event, phase) {
  const status = state.bridge?.getEventStatus?.(event);
  if (phase === 'live') return status?.label ? `LIVE · ${status.label}` : 'LIVE';
  if (phase === 'upcoming') return state.bridge?.getEspnFootText?.(event, status) || status?.label || '';
  return status?.label || 'Final';
}

function renderCard(event, sportId, { highlight = false } = {}) {
  const phase = getPhase(event);
  const summary = state.summaries[event.id];
  const { home, away, competition } = state.bridge.getCompetitors(event);
  const homeName = home?.team?.displayName || home?.team?.name || 'TBD';
  const awayName = away?.team?.displayName || away?.team?.name || 'TBD';
  const showScore = phase !== 'upcoming';
  const homeScore = showScore ? (home?.score ?? '-') : '';
  const awayScore = showScore ? (away?.score ?? '-') : '';

  let statusBadge = '';
  if (phase === 'live') statusBadge = '<span class="se-live-tag">LIVE</span>';
  else if (phase === 'finished') statusBadge = '<span class="se-ft-tag">FINAL</span>';

  const starHome = state.bridge.renderStarBtn(state.bridge.teamFavObj(sportId, home), true);
  const starAway = state.bridge.renderStarBtn(state.bridge.teamFavObj(sportId, away), true);

  const trackerHtml = phase === 'live' ? renderLiveTracker(event, summary, sportId) : '';
  const playsHtml = renderScoringPlays(event, summary, sportId, phase === 'live');
  const highlightsHtml = renderHighlights(event, summary);

  return `
    <article class="se-card ${phase}${highlight ? ' fav-game' : ''}" data-event-id="${event.id}">
      <div class="se-card-bar"></div>
      <div class="se-card-top">
        <span class="se-league">${esc(getEventLabel(event, sportId))}</span>
        ${statusBadge}
        <span class="se-kick" data-kickoff="${event.id}">${esc(state.bridge.formatTime(event.date))}</span>
      </div>
      ${renderWatchBar(event, summary, sportId, phase)}
      ${trackerHtml}
      <div class="se-body">
        <div class="se-side away-side ${phase === 'live' ? 'live-side' : ''}">
          ${teamLogo(away)}
          <span class="se-team">${esc(awayName)}</span>
          ${starAway}
          <div class="se-score-stack">
            <span class="se-score" data-away-score="${event.id}">${esc(String(awayScore))}</span>
            ${renderMlOdds(event, competition, 'away', phase)}
          </div>
        </div>
        <div class="se-mid">
          <span class="se-vs">${showScore ? '-' : 'vs'}</span>
        </div>
        <div class="se-side home-side ${phase === 'live' ? 'live-side' : ''}">
          ${teamLogo(home)}
          <span class="se-team">${esc(homeName)}</span>
          ${starHome}
          <div class="se-score-stack">
            <span class="se-score" data-home-score="${event.id}">${esc(String(homeScore))}</span>
            ${renderMlOdds(event, competition, 'home', phase)}
          </div>
        </div>
      </div>
      ${playsHtml}
      ${highlightsHtml}
      <div class="se-foot ${phase === 'live' ? 'live-text' : ''}" data-countdown="${event.id}">${esc(getFootText(event, phase))}</div>
    </article>`;
}

function patchCard(card, event, sportId) {
  const phase = getPhase(event);
  const summary = state.summaries[event.id];
  const { home, away, competition } = state.bridge.getCompetitors(event);
  const showScore = phase !== 'upcoming';

  card.className = `se-card ${phase}${card.classList.contains('fav-game') ? ' fav-game' : ''}`;

  const top = card.querySelector('.se-card-top');
  if (top) {
    if (phase === 'live') {
      top.querySelector('.se-ft-tag')?.remove();
      if (!top.querySelector('.se-live-tag')) top.insertAdjacentHTML('beforeend', '<span class="se-live-tag">LIVE</span>');
    } else if (phase === 'finished') {
      top.querySelector('.se-live-tag')?.remove();
      if (!top.querySelector('.se-ft-tag')) top.insertAdjacentHTML('beforeend', '<span class="se-ft-tag">FINAL</span>');
    } else {
      top.querySelector('.se-live-tag')?.remove();
      top.querySelector('.se-ft-tag')?.remove();
    }
  }

  syncWatchBar(card, event, summary, sportId, phase);
  syncTracker(card, event, summary, sportId, phase);

  const homeScore = card.querySelector(`[data-home-score="${event.id}"]`);
  const awayScore = card.querySelector(`[data-away-score="${event.id}"]`);
  const vs = card.querySelector('.se-vs');
  if (showScore) {
    if (homeScore) homeScore.textContent = home?.score ?? '-';
    if (awayScore) awayScore.textContent = away?.score ?? '-';
    if (vs) vs.textContent = '-';
  } else {
    if (homeScore) homeScore.textContent = '';
    if (awayScore) awayScore.textContent = '';
    if (vs) vs.textContent = 'vs';
  }

  card.querySelectorAll('.se-side').forEach((side) => {
    side.classList.toggle('live-side', phase === 'live');
  });

  syncMlOdds(card, event, competition, phase);
  syncScoringPlays(card, event, summary, sportId, phase === 'live');
  syncHighlights(card, event, summary);

  const foot = card.querySelector(`[data-countdown="${event.id}"]`);
  if (foot) {
    foot.textContent = getFootText(event, phase);
    foot.classList.toggle('live-text', phase === 'live');
  }
}

async function fetchSummary(sport, eventId) {
  const url = `${ESPN_SITE}/${sport.category}/${sport.league}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
  return res.json();
}

function isTodayDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toLocaleDateString() === now.toLocaleDateString();
}

async function enrichEvents(sport, events) {
  if (!sport || !events?.length) return;
  state.sportId = sport.id;

  const targets = events.filter((e) => {
    const phase = getPhase(e);
    if (phase === 'live' || phase === 'upcoming') return true;
    if (phase === 'finished' && isTodayDate(e.date)) return true;
    return false;
  });

  const now = Date.now();
  await Promise.all(targets.map(async (e) => {
    const phase = getPhase(e);
    const last = state.summaryFetchedAt[e.id] || 0;
    const staleMs = phase === 'live' ? 5_000 : phase === 'upcoming' ? 60_000 : 120_000;
    if (state.summaries[e.id] && now - last < staleMs) return;
    try {
      const summary = await fetchSummary(sport, e.id);
      state.summaries[e.id] = summary;
      state.summaryFetchedAt[e.id] = now;
    } catch {
      /* keep prior summary if refresh fails */
    }
  }));
}

function tick(events, sportId) {
  if (!events?.length) return;
  document.querySelectorAll('#scoreboard-grid .se-card[data-event-id]').forEach((card) => {
    const event = events.find((e) => String(e.id) === card.dataset.eventId);
    if (!event) return;
    const phase = getPhase(event);
    const summary = state.summaries[event.id];
    if (phase === 'live') {
      syncTracker(card, event, summary, sportId, phase);
    }
    if (phase === 'upcoming') {
      const foot = card.querySelector(`[data-countdown="${event.id}"]`);
      const status = state.bridge?.getEventStatus?.(event);
      if (foot && status) foot.textContent = state.bridge.getEspnFootText(event, status);
    }
  });
}

function closeHighlightPip() {
  const pip = $('#highlight-pip');
  const video = pip?.querySelector('video');
  const iframe = pip?.querySelector('iframe');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.hidden = true;
  }
  if (iframe) {
    iframe.removeAttribute('src');
    iframe.hidden = true;
  }
  if (pip) pip.hidden = true;
}

function ensureHighlightPip() {
  let pip = $('#highlight-pip');
  if (pip) return pip;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="highlight-pip" class="goal-pip" hidden role="dialog" aria-label="Highlight player">
      <div class="goal-pip-head" data-pip-drag>
        <span class="goal-pip-grip" aria-hidden="true">⠿</span>
        <span class="goal-pip-title">Highlight</span>
        <button type="button" class="goal-pip-close" aria-label="Close player">✕</button>
      </div>
      <div class="goal-pip-body">
        <video controls playsinline hidden></video>
        <iframe title="Highlight" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                allowfullscreen referrerpolicy="strict-origin-when-cross-origin" hidden></iframe>
      </div>
      <div class="goal-pip-resize" data-pip-resize role="presentation" aria-hidden="true"></div>
    </div>`);
  pip = $('#highlight-pip');
  initPipDrag(pip);
  initPipResize(pip);
  pip.querySelector('.goal-pip-close')?.addEventListener('click', closeHighlightPip);
  return pip;
}

function openHighlightPip({ mp4, title }) {
  const pip = ensureHighlightPip();
  const video = pip.querySelector('video');
  const iframe = pip.querySelector('iframe');
  pip.querySelector('.goal-pip-title').textContent = title || 'Highlight';
  if (mp4 && video) {
    iframe.hidden = true;
    iframe.removeAttribute('src');
    video.hidden = false;
    video.src = mp4;
    video.play().catch(() => {});
  }
  pip.hidden = false;
}

function anchorPip(pip) {
  const rect = pip.getBoundingClientRect();
  pip.style.right = 'auto';
  pip.style.bottom = 'auto';
  pip.style.left = `${rect.left}px`;
  pip.style.top = `${rect.top}px`;
}

function initPipResize(pip) {
  const handle = pip.querySelector('[data-pip-resize]');
  if (!handle) return;
  const MIN_W = 240;
  let resizing = false;
  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    if (!resizing) return;
    pip.style.width = `${Math.max(MIN_W, Math.min(960, window.innerWidth - 16, startW + (e.clientX - startX)))}px`;
  };
  const onUp = () => {
    resizing = false;
    handle.classList.remove('is-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    anchorPip(pip);
    resizing = true;
    startX = e.clientX;
    startW = pip.offsetWidth;
    handle.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function initPipDrag(pip) {
  const handle = pip.querySelector('[data-pip-drag]');
  if (!handle) return;
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let originX = 0;
  let originY = 0;

  const onMove = (e) => {
    if (!dragging) return;
    pip.style.left = `${Math.max(8, Math.min(window.innerWidth - pip.offsetWidth - 8, originX + e.clientX - offsetX))}px`;
    pip.style.top = `${Math.max(8, Math.min(window.innerHeight - pip.offsetHeight - 8, originY + e.clientY - offsetY))}px`;
  };
  const onUp = () => {
    dragging = false;
    handle.classList.remove('is-dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.goal-pip-close')) return;
    dragging = true;
    handle.classList.add('is-dragging');
    anchorPip(pip);
    const rect = pip.getBoundingClientRect();
    originX = rect.left;
    originY = rect.top;
    offsetX = e.clientX;
    offsetY = e.clientY;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function bindGrid(root = document) {
  root.querySelectorAll('.ge-clip-btn[data-mp4]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      openHighlightPip({ mp4: btn.dataset.mp4, title: btn.dataset.title });
    });
  });
  state.bridge?.bindStarButtons?.(root);
}

window.EspnLive = {
  configure,
  clearSummaries,
  enrichEvents,
  renderCard,
  patchCard,
  tick,
  bindGrid,
  getPhase,
};

})();