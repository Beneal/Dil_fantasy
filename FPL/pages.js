/* ==========================================================================
   DIL FANTASY — page controllers
   Depends on script.js. Dispatches on <body data-page="…">.
   ========================================================================== */
'use strict';

/* ========================= SHARED RENDERERS ============================== */

/** Fill every <span data-icon="name"> placeholder with its SVG. */
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (el.dataset.iconDone === '1') return;
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize) || 22);
    el.dataset.iconDone = '1';
  });
}

const TRUST_ITEMS = [
  { icon: 'lock', label: 'Secure payment verification' },
  { icon: 'refresh', label: 'Official FPL data — read only' },
  { icon: 'gift', label: 'Transparent rewards' },
  { icon: 'users', label: 'Fair competition' }
];

function renderTrustBar(mountId = 'trust-bar') {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  mount.innerHTML = TRUST_ITEMS.map((t) => `
    <div class="trust-item">
      <span class="trust-icon">${icon(t.icon, 18)}</span>
      <span>${t.label}</span>
    </div>`).join('');
}

/* -------------------------------- News ---------------------------------- */

const NEWS_CATEGORIES = {
  'FPL UPDATES': 'green',
  'INJURIES': 'purple',
  'TRANSFERS': 'green',
  'PLAYER NEWS': 'purple'
};

function buildNews() {
  const gw = Tournament.gameweekAt();
  const day = MS.day;
  const now = TimeService.now();
  const items = [
    {
      category: 'FPL UPDATES', image: 'assets/news-1.svg',
      title: `Gameweek ${gw} price rises: who is climbing fastest`,
      excerpt: 'The latest market movers ahead of the next deadline, and which rises are worth acting on early.',
      published: now - day
    },
    {
      category: 'INJURIES', image: 'assets/news-2.svg',
      title: 'Assessing the fitness of three key premium picks',
      excerpt: 'Injury updates, expected return dates and what each one means for your captaincy call.',
      published: now - day * 2
    },
    {
      category: 'TRANSFERS', image: 'assets/news-3.svg',
      title: 'Deadline-day moves that reshape early-season value',
      excerpt: 'Squad changes that open up new budget routes into the best attacking returns.',
      published: now - day * 3
    },
    {
      category: 'PLAYER NEWS', image: 'assets/news-4.svg',
      title: 'Form watch: the differential defenders to consider',
      excerpt: 'Underrated defensive picks with attacking upside and a friendly run of fixtures.',
      published: now - day * 4
    },
    {
      category: 'FPL UPDATES', image: 'assets/news-1.svg',
      title: 'Reading the fixture ticker before you use a free transfer',
      excerpt: 'A short guide to weighting fixtures against form when the schedule tightens.',
      published: now - day * 6
    },
    {
      category: 'TRANSFERS', image: 'assets/news-3.svg',
      title: 'When taking a hit actually pays off',
      excerpt: 'The break-even maths behind a four-point hit, explained with recent gameweek data.',
      published: now - day * 8
    },
    {
      category: 'PLAYER NEWS', image: 'assets/news-4.svg',
      title: 'Rotation risk: managers who rarely name the same XI',
      excerpt: 'Which squads make ownership a gamble, and how to plan around minutes uncertainty.',
      published: now - day * 10
    },
    {
      category: 'INJURIES', image: 'assets/news-2.svg',
      title: 'Bench planning for a congested midweek schedule',
      excerpt: 'How to set an autosub order that survives a round of late team-news surprises.',
      published: now - day * 12
    }
  ];
  return items;
}

function newsCard(item, wide = false) {
  const tone = NEWS_CATEGORIES[item.category] || 'gray';
  return `
    <article class="card card--hover news-card${wide ? ' news-card--wide' : ''}">
      <div class="news-thumb">
        <img src="${item.image}" alt="" loading="lazy" width="640" height="400">
        <span class="badge badge--${tone}">${item.category}</span>
      </div>
      <div class="news-body">
        <h3>${escapeHTML(item.title)}</h3>
        <p>${escapeHTML(item.excerpt)}</p>
        <div class="news-foot">
          <span>${EAT.shortDate(item.published)}</span>
          <a href="#" data-news-read="${escapeHTML(item.title)}">Read more ${icon('arrow', 14)}</a>
        </div>
      </div>
    </article>`;
}

function wireNewsLinks(root = document) {
  root.addEventListener('click', (e) => {
    const link = e.target.closest('[data-news-read]');
    if (!link) return;
    e.preventDefault();
    UI.modal({
      title: link.dataset.newsRead,
      subtitle: 'Dil Fantasy editorial',
      body: `<div class="notice notice--purple">${icon('info', 18)}
        <div>Full articles are published by the Dil Fantasy editorial team. This build ships the news
        layout and card system; article bodies are loaded from the content service once it is connected.</div>
      </div>
      <p style="margin-top:16px">In the meantime, the tournament rules and scoring explanation are available
      on the rules page.</p>`,
      footer: `<button class="btn btn--ghost" type="button" data-close>Close</button>
               <a class="btn btn--purple" href="rules.html">Read the rules</a>`
    });
  });
}

/* ---------------------------- Tournaments -------------------------------- */

/* Fills every [data-live-count] / [data-live-pool] placeholder on the page
   from DataService.getTournamentSummary (schema.sql query A). Called on load
   and again whenever an application changes the totals. */
async function hydrateLiveCounts(scope = document) {
  const nodes = [...$$('[data-live-count]', scope), ...$$('[data-live-pool]', scope)];
  if (!nodes.length) return;
  const weeks = [...new Set(nodes.map((n) =>
    Number(n.dataset.liveCount ?? n.dataset.livePool)))].filter(Number.isFinite);

  await Promise.all(weeks.map(async (gw) => {
    let summary;
    try {
      summary = Tournament.cacheSummary(await DataService.getParticipantCount(gw));
    } catch (err) {
      // A failed count must not blank the card; leave the placeholder.
      console.warn('[Dil Fantasy] Participant count unavailable for GW' + gw, err);
      $$(`[data-live-count="${gw}"]`, scope).forEach((n) => { n.textContent = '—'; });
      return;
    }
    $$(`[data-live-count="${gw}"]`, scope).forEach((n) => {
      n.textContent = formatNumber(summary.confirmed);
    });
    $$(`[data-live-pool="${gw}"]`, scope).forEach((n) => {
      n.textContent = formatBirr(summary.prizePool);
    });
  }));
}

/* Any page can ask to be refreshed when the participant table changes. */
function onParticipantsChanged(handler) {
  document.addEventListener('dil:participants-changed', handler);
}

function tournamentCard(t) {
  const entry = Entries.forGameweek(t.gameweek);
  const status = entry ? STATUS_BY_KEY[entry.status] : null;
  const phaseBadge = {
    upcoming: '<span class="badge badge--green">Upcoming</span>',
    active: '<span class="badge badge--purple">Active</span>',
    completed: '<span class="badge badge--gray">Completed</span>'
  }[t.phase];

  const statusClass = t.phase === 'upcoming' ? 'tc-status--open' : t.phase === 'active' ? 'tc-status--active' : 'tc-status--done';

  let action;
  if (t.phase === 'upcoming' && t.isCurrent) {
    action = `<button class="btn btn--block" type="button"
        data-action="join-tournament" data-gameweek="${t.gameweek}" data-requires-registration
        data-label-open="Apply now" data-label-closed="Registration closed">
        <span data-btn-label>Apply now</span></button>`;
  } else if (t.phase === 'upcoming') {
    action = `<button class="btn btn--block btn--muted" type="button" disabled aria-disabled="true">Opens ${EAT.shortDate(t.opensAt)}</button>`;
  } else {
    action = `<a class="btn btn--block ${t.phase === 'active' ? 'btn--outline-purple' : 'btn--ghost'}"
        href="tournament.html?gw=${t.gameweek}">${t.phase === 'active' ? 'View tournament' : 'View results'}</a>`;
  }

  const dateLine = t.phase === 'upcoming'
    ? `Deadline: ${EAT.date(t.closesAt)} • ${EAT.time(t.closesAt)} EAT`
    : t.phase === 'active'
      ? `Started: ${EAT.date(t.closesAt)}`
      : `Ended: ${EAT.date(t.endsAt)}`;

  return `
    <article class="card card--hover tournament-card">
      <div class="row-between">
        ${phaseBadge}
        ${t.isCurrent ? '<span class="mono-label">This week</span>' : ''}
      </div>
      <div>
        <h3>Gameweek ${t.gameweek}</h3>
        <p class="tc-status ${statusClass}">
          <span class="status-dot${t.phase === 'completed' ? ' status-dot--closed' : ''}"></span>
          ${escapeHTML(t.statusText)}
        </p>
      </div>
      <p class="tc-date">${icon('calendar', 15)} ${dateLine}</p>
      <div class="tc-meta">
        <div class="tc-meta-item">${icon('users', 16)}
          <div><strong data-live-count="${t.gameweek}">—</strong><span>Participants</span></div>
        </div>
        <div class="tc-meta-item">${icon(t.phase === 'upcoming' ? 'wallet' : 'trophy', 16)}
          <div><strong>${t.phase === 'upcoming'
            ? `${t.entryFee} Birr`
            : `<span data-live-pool="${t.gameweek}">—</span>`}</strong>
          <span>${t.phase === 'upcoming' ? 'Entry fee' : 'Prize pool'}</span></div>
        </div>
      </div>
      ${status ? `<p class="tc-user-state ${status.key === 'confirmed' ? 'tc-user-state--in' : 'tc-user-state--pending'}">
          ${icon(status.key === 'confirmed' ? 'check' : 'clock', 15)} Your entry: ${status.label}</p>` : ''}
      ${action}
    </article>`;
}

function wireCarousels() {
  $$('.carousel-btn').forEach((btn) => {
    btn.innerHTML = icon(btn.dataset.dir === 'prev' ? 'chevronLeft' : 'chevronRight', 18);
    btn.addEventListener('click', () => {
      const track = document.getElementById(btn.dataset.carousel);
      if (!track) return;
      const amount = track.clientWidth * 0.8 * (btn.dataset.dir === 'prev' ? -1 : 1);
      track.scrollBy({ left: amount, behavior: 'smooth' });
    });
  });
}

/* ---------------------------- Leaderboard -------------------------------- */

function movementCell(move) {
  if (move > 0) return `<span class="move up">▲ ${move}</span>`;
  if (move < 0) return `<span class="move down">▼ ${Math.abs(move)}</span>`;
  return '<span class="move flat">— 0</span>';
}

function rankCell(rank) {
  if (rank <= 3) return `<span class="rank-medal" data-rank="${rank}">${rank}</span>`;
  return `<span class="rank-plain">${rank}</span>`;
}

function leaderboardTable(rows, { compact = false } = {}) {
  if (!rows.length) {
    return `<div class="empty-state">
      <div class="ico">${icon('trophy', 26)}</div>
      <h3>No standings yet</h3>
      <p>Standings appear once the gameweek starts and official FPL scores are published.</p>
    </div>`;
  }
  return `
    <table class="data">
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Manager</th>
          <th scope="col">FPL team</th>
          <th scope="col">GW points</th>
          ${compact ? '' : '<th scope="col">Total points</th>'}
          <th scope="col">Rank movement</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr${r.isYou ? ' class="is-you"' : ''}>
            <td>${rankCell(r.rank)}</td>
            <td>
              <span class="manager-cell">
                <span class="avatar avatar--sm" aria-hidden="true">${escapeHTML(initials(r.managerName))}</span>
                ${escapeHTML(r.isYou ? 'You' : r.managerName)}
              </span>
            </td>
            <td class="text-soft">${escapeHTML(r.teamName)}</td>
            <td class="num"><strong>${formatNumber(r.gwPoints)}</strong></td>
            ${compact ? '' : `<td class="num">${formatNumber(r.totalPoints)}</td>`}
            <td>${movementCell(r.movement)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function tableSkeleton(rows = 6) {
  return `<div style="padding:18px;display:grid;gap:14px">
    ${Array.from({ length: rows }, () => '<div class="skeleton" style="height:22px"></div>').join('')}
  </div>`;
}

/* ------------------------------- Charts ---------------------------------- */

/**
 * Minimal dependency-free SVG line chart.
 * points: [{ label, value }]
 */
function lineChart(mount, points, {
  color = 'var(--green-500)', fill = 'rgba(18,226,127,.14)',
  height = 190, invert = false, valueFormat = formatNumber, name = 'Points'
} = {}) {
  if (!mount || !points.length) return;
  const w = 640;
  const h = height;
  const padL = 34, padR = 14, padT = 16, padB = 26;
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.12; max += span * 0.12;

  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v) => {
    const t = (v - min) / (max - min);
    return invert ? padT + t * (h - padT - padB) : h - padB - t * (h - padT - padB);
  };

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - padB} L${padL},${h - padB} Z`;

  const gridCount = 4;
  const grid = Array.from({ length: gridCount + 1 }, (_, i) => {
    const gy = padT + (i * (h - padT - padB)) / gridCount;
    const gv = invert
      ? min + (i / gridCount) * (max - min)
      : max - (i / gridCount) * (max - min);
    return `<line class="gridline" x1="${padL}" x2="${w - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/>
            <text class="axis-label" x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${valueFormat(Math.round(gv))}</text>`;
  }).join('');

  const step = Math.ceil(points.length / 8);
  const xLabels = points.map((p, i) => (i % step === 0 || i === points.length - 1)
    ? `<text class="axis-label" x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle">${escapeHTML(p.label)}</text>`
    : '').join('');

  const dots = points.map((p, i) => `
    <circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"
      fill="var(--white)" stroke="${color}" stroke-width="2.5"
      data-label="${escapeHTML(p.label)}" data-value="${p.value}" tabindex="0" role="img"
      aria-label="${escapeHTML(p.label)}: ${valueFormat(p.value)} ${name}"></circle>`).join('');

  mount.innerHTML = `
    <div class="chart-holder">
      <svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="group" aria-label="${escapeHTML(name)} chart">
        <defs>
          <linearGradient id="fill-${Math.random().toString(36).slice(2, 7)}" x1="0" y1="0" x2="0" y2="1"></linearGradient>
        </defs>
        ${grid}
        <path d="${area}" fill="${fill}"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
        ${xLabels}
      </svg>
      <div class="chart-tip" role="status"></div>
    </div>`;

  const tip = $('.chart-tip', mount);
  const holder = $('.chart-holder', mount);
  const show = (circle) => {
    const rect = holder.getBoundingClientRect();
    const cRect = circle.getBoundingClientRect();
    tip.innerHTML = `${escapeHTML(circle.dataset.label)} · <b>${valueFormat(Number(circle.dataset.value))}</b>`;
    tip.style.left = `${cRect.left - rect.left + cRect.width / 2}px`;
    tip.style.top = `${cRect.top - rect.top}px`;
    tip.dataset.show = 'true';
  };
  $$('.dot', mount).forEach((c) => {
    c.addEventListener('mouseenter', () => show(c));
    c.addEventListener('focus', () => show(c));
    c.addEventListener('mouseleave', () => { tip.dataset.show = 'false'; });
    c.addEventListener('blur', () => { tip.dataset.show = 'false'; });
  });
}

function barChart(mount, points, { color = 'var(--purple-600)', height = 190, valueFormat = formatNumber, name = 'Value' } = {}) {
  if (!mount || !points.length) return;
  const w = 640, h = height, padL = 34, padR = 14, padT = 16, padB = 26;
  const max = Math.max(...points.map((p) => p.value)) * 1.15 || 1;
  const slot = (w - padL - padR) / points.length;
  const barW = Math.min(46, slot * 0.55);

  const bars = points.map((p, i) => {
    const bh = (p.value / max) * (h - padT - padB);
    const bx = padL + slot * i + (slot - barW) / 2;
    const by = h - padB - bh;
    return `
      <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, bh).toFixed(1)}"
        rx="6" fill="${p.highlight ? 'var(--green-500)' : color}" opacity="${p.highlight ? 1 : .85}">
        <title>${escapeHTML(p.label)}: ${valueFormat(p.value)}</title>
      </rect>
      <text class="axis-label" x="${(bx + barW / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle">${escapeHTML(p.label)}</text>`;
  }).join('');

  const grid = Array.from({ length: 4 }, (_, i) => {
    const gy = padT + (i * (h - padT - padB)) / 4;
    const gv = max - (i / 4) * max;
    return `<line class="gridline" x1="${padL}" x2="${w - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/>
            <text class="axis-label" x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${valueFormat(Math.round(gv))}</text>`;
  }).join('');

  mount.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHTML(name)}">
    ${grid}${bars}
  </svg>`;
}

/* --------------------------- Small helpers ------------------------------- */

function maskAccount(value) {
  const s = String(value || '');
  if (s.length <= 4) return s.replace(/./g, '*');
  return s.slice(0, 2) + '*'.repeat(Math.max(3, s.length - 6)) + s.slice(-4);
}

function rewardSummary(reward) {
  if (!reward) return 'Not set';
  if (reward.method === 'telebirr') return `Telebirr — ${maskAccount(reward.account)}`;
  if (reward.method === 'cbe') return `CBE — ${maskAccount(reward.account)}`;
  return `${reward.bankName || 'Bank'} — ${maskAccount(reward.account)}`;
}

function requirePage(pageUser) {
  if (pageUser) return true;
  window.location.href = 'login.html';
  return false;
}

function pageQuery(key) {
  return new URLSearchParams(window.location.search).get(key);
}


/* Reward totals, summed from the rewards rows the API returned. */
function rewardTotals(user) {
  const rewards = user.rewards || [];
  return {
    paid: rewards.reduce((s, r) => s + (r.status === 'paid' ? r.amount : 0), 0),
    pending: rewards.reduce((s, r) => s + (r.status === 'pending' ? r.amount : 0), 0)
  };
}

/* ================== PUBLIC PARTICIPANT DIRECTORY ========================
   Reads DataService.getParticipants (schema.sql query B). That query's
   SELECT list is the privacy contract: manager name, FPL team name, status
   and applied-at. Nothing else reaches this function, so nothing else can
   leak into the page.                                                    */

function participantCard(row) {
  const confirmed = row.status === 'confirmed';
  return `
    <article class="participant" data-status="${escapeHTML(row.status)}">
      <span class="avatar" aria-hidden="true">${escapeHTML(initials(row.displayName))}</span>
      <div class="participant-id">
        <h3>${escapeHTML(row.isYou ? `${row.displayName} (you)` : row.displayName)}</h3>
        <p>${escapeHTML(row.teamName)}</p>
      </div>
      <span class="participant-state ${confirmed ? 'is-in' : 'is-pending'}">
        ${icon(confirmed ? 'check' : 'clock', 13, confirmed ? 3 : 2)}
        ${confirmed ? 'Confirmed' : 'Applied'}
      </span>
    </article>`;
}

async function mountParticipants({ gameweek } = {}) {
  const grid = $('#participants-grid');
  if (!grid) return;
  const gw = gameweek || Tournament.gameweekAt();
  const pageSize = 12;
  let page = 1;
  let rows = [];
  let meta = null;

  const searchEl = $('#participants-search');
  const moreBtn = $('#participants-more');

  function renderStats() {
    if (!meta) return;
    $('#participants-stats').innerHTML = [
      { label: 'Confirmed participants', value: formatNumber(meta.confirmed), tone: 'is-green' },
      { label: 'Applications pending review', value: formatNumber(meta.pending), tone: 'is-purple' },
      { label: 'Entry fee', value: `${DIL_CONFIG.ENTRY_FEE_BIRR} Birr`, tone: '' },
      { label: 'Gameweek', value: String(gw), tone: '' }
    ].map((s) => `
      <div class="participants-stat ${s.tone}">
        <span class="mono-label">${s.label}</span>
        <strong>${s.value}</strong>
      </div>`).join('');
     }

  async function load({ append = false } = {}) {
    if (!append) {
      grid.innerHTML = Array.from({ length: 6 }, () =>
        '<div class="participant is-loading"><span class="skeleton" style="width:100%;height:38px"></span></div>').join('');
    }
    let data;
    try {
      data = await DataService.getParticipants(gw, {
        search: searchEl ? searchEl.value : '', page, pageSize
      });
    } catch (err) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="ico">${icon('alert', 24)}</div>
        <h3>Participants could not be loaded</h3>
        <p>The list will appear once the connection is restored.</p>
        <button class="btn btn--ghost" type="button" id="participants-retry">Try again</button>
      </div>`;
      const retry = $('#participants-retry');
      if (retry) retry.addEventListener('click', () => { page = 1; load(); });
      hydrateIcons();
      return;
    }

    meta = data;
    rows = append ? rows.concat(data.rows) : data.rows;
    renderStats();

    const term = searchEl ? searchEl.value.trim() : '';
    if (!rows.length) {
      grid.innerHTML = term
        ? `<div class="empty-state" style="grid-column:1/-1">
             <div class="ico">${icon('search', 24)}</div>
             <h3>No participant matches “${escapeHTML(term)}”</h3>
             <p>Try a manager name or an FPL team name.</p>
           </div>`
        : `<div class="empty-state" style="grid-column:1/-1">
             <div class="ico">${icon('users', 24)}</div>
             <h3>No applications yet for Gameweek ${gw}</h3>
             <p>Be the first to apply — everyone who joins appears here.</p>
             <button class="btn" type="button" data-action="join-tournament"
               data-gameweek="${gw}" data-requires-registration
               data-label-open="Apply now" data-label-closed="Registration closed">
               <span data-btn-label>Apply now</span></button>
           </div>`;
    } else {
      grid.innerHTML = rows.map(participantCard).join('');
    }

    const shown = rows.length;
    $('#participants-count').textContent = shown
      ? `Showing ${formatNumber(shown)} of ${formatNumber(data.total)} applicants for Gameweek ${gw}.`
      : '';
    if (moreBtn) moreBtn.hidden = shown >= data.total;
    hydrateIcons();
  }

  if (searchEl) {
    let t = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { page = 1; load(); }, 220);
    });
  }
  if (moreBtn) {
    moreBtn.addEventListener('click', () => { page += 1; load({ append: true }); });
  }

  // The counter is live: applying in this browser refreshes it immediately.
  onParticipantsChanged(() => { page = 1; load(); });

  await load();
}

/* ============================ PAGE: HOME ================================= */

async function pageHome() {
  renderTrustBar();
  hydrateIcons();
  wireCarousels();
  wireNewsLinks(document);

  $('#news-grid').innerHTML = buildNews().slice(0, 4).map((n) => newsCard(n)).join('');

  const list = Tournament.list(TimeService.now(), 3);
  $('#home-tournaments').innerHTML = list.slice(0, 5).map(tournamentCard).join('');
  hydrateIcons();
  hydrateLiveCounts();
  mountParticipants();
  onParticipantsChanged(() => hydrateLiveCounts());

  const lbMount = $('#home-leaderboard');
  lbMount.innerHTML = tableSkeleton(6);
  const data = await DataService.getLeaderboard({ size: 24 });
  const you = data.rows.find((r) => r.isYou);
  const top = data.rows.slice(0, 5);
  const rows = you && !top.includes(you) ? [...top, you] : top;
  lbMount.innerHTML = leaderboardTable(rows, { compact: false });

  const user = Auth.current();
  const perf = $('#home-performance');
  if (user && user.fpl) {
    // GET /users/:id/performance — the same rows the dashboard chart uses.
    let series = [];
    let dash = null;
    try {
      const [perfData, dashData] = await Promise.all([
        DataService.getPerformance(user.id),
        DataService.getDashboard(user.id)
      ]);
      series = perfData.rows
        .filter((r) => r.gwPoints != null)
        .slice(-6)
        .map((r) => ({ label: `GW${r.gwNumber}`, value: r.gwPoints }));
      dash = dashData.stats;
    } catch (err) {
      series = [];
    }
    perf.innerHTML = `
      <p class="mono-label">Your performance</p>
      <div id="home-chart" style="margin-top:14px"></div>
      <div class="kpis">
        <div><div class="v">#${dash && dash.currentRank ? dash.currentRank : '—'}</div><div class="k">Your rank</div></div>
        <div><div class="v">${dash && dash.gwPoints != null ? formatNumber(dash.gwPoints) : '—'}</div><div class="k">GW points</div></div>
        <div><div class="v">${dash ? formatNumber(dash.totalPoints) : '—'}</div><div class="k">Total points</div></div>
      </div>
      <a class="btn btn--block btn--ghost btn--ghost-light" href="performance.html">View my performance ${icon('arrow', 15)}</a>`;
    if (series.length) {
      lineChart($('#home-chart'), series, { height: 150, name: 'Gameweek points' });
    } else {
      $('#home-chart').innerHTML = `<p style="font-size:.85rem;color:rgba(255,255,255,.55);margin:0 0 4px">
        Your chart starts once a gameweek you entered has been scored.</p>`;
    }
  } else {
    perf.innerHTML = `
      <p class="mono-label">Your performance</p>
      <h3 style="margin:12px 0 8px;font-size:1.15rem">Not on the board yet</h3>
      <p style="font-size:.9rem;color:rgba(255,255,255,.6);margin-bottom:18px">
        Register, connect your FPL Manager ID and join a gameweek to see your rank here.</p>
      <a class="btn btn--block" href="register.html">Create your account</a>
      <a class="btn btn--block btn--ghost btn--ghost-light" style="margin-top:10px" href="login.html">I already have one</a>`;
  }
}

/* ========================= PAGE: LEADERBOARD ============================= */

async function pageLeaderboard() {
  const state = Tournament.state();
  const mount = $('#lb-mount');
  const strip = $('#your-rank');
  let cache = null;

  const scopes = {
    gameweek: { label: `Gameweek ${state.gameweek}`, size: 40 },
    tournament: { label: `Gameweek ${state.gameweek} tournament`, size: 30 },
    overall: { label: 'Season overall', size: 40 },
    previous: { label: `Gameweek ${Math.max(1, state.gameweek - 1)}`, size: 40 }
  };

  async function renderStats(gw, scope) {
    const bar = $('#lb-stats');
    if (!bar) return;
    bar.innerHTML = Array.from({ length: 4 }, () =>
      '<div class="lb-stat"><span class="skeleton" style="width:60%"></span><span class="skeleton" style="width:40%;height:24px;margin-top:10px"></span></div>').join('');
    let s;
    try {
      s = (await DataService.getLeaderboard({ gameweek: gw, scope, size: 1 })).stats;
    } catch (err) {
      bar.innerHTML = `<p class="lb-stats-error">${icon('alert', 16)}
        Statistics are unavailable right now.</p>`;
      hydrateIcons();
      return;
    }
    bar.innerHTML = [
      { label: 'Participants', value: formatNumber(s.participants), tone: 'is-green' },
      { label: 'Average points', value: formatNumber(s.averagePoints), tone: '' },
      { label: 'Highest score', value: formatNumber(s.highestPoints), tone: 'is-purple',
        sub: s.topManager ? escapeHTML(s.topManager) : '' },
      { label: 'Your rank', value: s.yourRank ? `#${s.yourRank}` : '—', tone: '',
        sub: s.yourRank ? '' : (Auth.isLoggedIn() ? 'Join to be ranked' : 'Register to be ranked') }
    ].map((t) => `
      <div class="lb-stat ${t.tone}">
        <span class="mono-label">${t.label}</span>
        <strong>${t.value}</strong>
        ${t.sub ? `<small>${t.sub}</small>` : ''}
      </div>`).join('');
  }

  async function load(scope) {
    mount.innerHTML = tableSkeleton(8);
    const gw = scope === 'previous' ? Math.max(1, state.gameweek - 1) : state.gameweek;
    renderStats(gw, scope);
    const data = await DataService.getLeaderboard({ gameweek: gw, scope, size: scopes[scope].size });
    cache = data;
    renderPodium(data.rows.slice(0, 3));
    applyFilters();
    const you = data.rows.find((r) => r.isYou);
    strip.innerHTML = you ? `
      <div><span class="mono-label">Your rank</span><span class="v">#${you.rank}</span></div>
      <div><span class="mono-label">GW points</span><span class="v num">${formatNumber(you.gwPoints)}</span></div>
      <div><span class="mono-label">Total points</span><span class="v num">${formatNumber(you.totalPoints)}</span></div>
      <div><span class="mono-label">Movement</span><span class="v">${movementCell(you.movement)}</span></div>`
      : `<div style="grid-column:1/-1;text-align:center">
          <span class="mono-label">Your rank</span>
          <p style="margin-top:6px">${Auth.isLoggedIn()
            ? 'Join this gameweek to appear on the leaderboard.'
            : '<a class="link-more" href="register.html">Create an account</a> to track your position here.'}</p>
        </div>`;
     }

  function renderPodium(top) {
    const podium = $('#podium');
    if (!podium) return;
    const crowns = ['🥇', '🥈', '🥉'];
    podium.innerHTML = top.map((r, i) => `
      <div class="podium-card" data-place="${i + 1}">
        <div class="crown" aria-hidden="true">${crowns[i]}</div>
        <span class="avatar" aria-hidden="true">${escapeHTML(initials(r.managerName))}</span>
        <h3>${escapeHTML(r.isYou ? 'You' : r.managerName)}</h3>
        <p class="team">${escapeHTML(r.teamName)}</p>
        <p class="pts">${formatNumber(r.gwPoints)}<small>Gameweek points</small></p>
      </div>`).join('');
  }

  function applyFilters() {
    if (!cache) return;
    const q = ($('#lb-search').value || '').toLowerCase().trim();
    const sort = $('#lb-sort').value;
    let rows = cache.rows.filter((r) =>
      !q || r.managerName.toLowerCase().includes(q) || r.teamName.toLowerCase().includes(q));
    rows = [...rows].sort((a, b) => {
      if (sort === 'total') return b.totalPoints - a.totalPoints;
      if (sort === 'movement') return b.movement - a.movement;
      return a.rank - b.rank;
    });
    mount.innerHTML = rows.length ? leaderboardTable(rows) : `
      <div class="empty-state">
        <div class="ico">${icon('search', 26)}</div>
        <h3>No managers match “${escapeHTML(q)}”</h3>
        <p>Try a manager name or an FPL team name.</p>
        <button class="btn btn--ghost" type="button" id="clear-search">Clear search</button>
      </div>`;
    const clear = $('#clear-search');
    if (clear) clear.addEventListener('click', () => { $('#lb-search').value = ''; applyFilters(); });
  }

  UI.tabs($('#lb-tabs'), (key) => load(key));
  onParticipantsChanged(() => {
    const active = $('#lb-tabs .tab[aria-selected="true"]');
    load(active ? active.dataset.tab : 'gameweek');
  });
  $('#lb-search').addEventListener('input', applyFilters);
  $('#lb-sort').addEventListener('change', applyFilters);
  hydrateIcons();
}

/* ========================= PAGE: TOURNAMENTS ============================= */

function pageTournaments() {
  const render = () => {
    const now = TimeService.now();
    const all = Tournament.list(now, 8);
    const buckets = {
      upcoming: all.filter((t) => t.phase === 'upcoming'),
      active: all.filter((t) => t.phase === 'active'),
      completed: all.filter((t) => t.phase === 'completed')
    };
    Object.entries(buckets).forEach(([key, items]) => {
      const mount = document.querySelector(`[data-bucket="${key}"]`);
      if (!mount) return;
      mount.innerHTML = items.length
        ? items.map(tournamentCard).join('')
        : `<div class="empty-state" style="grid-column:1/-1">
            <div class="ico">${icon('calendar', 26)}</div>
            <h3>Nothing here yet</h3>
            <p>${key === 'completed'
              ? 'Completed tournaments appear here once a gameweek finishes.'
              : 'The next tournament opens on Sunday at 12:00 AM EAT.'}</p>
          </div>`;
      const count = document.querySelector(`[data-count="${key}"]`);
      if (count) count.textContent = items.length;
    });
    hydrateIcons();
    hydrateLiveCounts();
  };
  render();
  UI.tabs($('#tournament-tabs'));
  onParticipantsChanged(() => hydrateLiveCounts());
  // Re-render on gameweek rollover so cards move between buckets on their own.
  let lastGw = Tournament.gameweekAt();
  ClockBus.subscribe((state) => {
    if (state.gameweek !== lastGw) { lastGw = state.gameweek; render(); }
  });
}

/* ====================== PAGE: TOURNAMENT DETAIL ========================== */

async function pageTournamentDetail() {
  const state = Tournament.state();
  const gw = Number(pageQuery('gw')) || state.gameweek;
  const t = Tournament.describe(gw);
  const entry = Entries.forGameweek(gw);

  $('#td-title').textContent = `Gameweek ${gw} tournament`;
  $('#td-status').innerHTML = `<span class="status-dot${t.phase === 'completed' ? ' status-dot--closed' : ''}"></span> ${escapeHTML(t.statusText)}`;

  $('#td-facts').innerHTML = `
    <div><span class="k">Registration</span><span class="v">${escapeHTML(t.statusText)}</span></div>
    <div><span class="k">Participants</span><span class="v num" data-live-count="${gw}">—</span></div>
    <div><span class="k">Entry fee</span><span class="v">${t.entryFee} Birr, non-refundable</span></div>
    <div><span class="k">Prize pool</span><span class="v" data-live-pool="${gw}">—</span></div>
    <div><span class="k">Registration opened</span><span class="v">${EAT.full(t.opensAt)}</span></div>
    <div><span class="k">Registration deadline</span><span class="v">${EAT.full(t.closesAt)}</span></div>
    <div><span class="k">Your entry</span><span class="v">${entry ? escapeHTML(STATUS_BY_KEY[entry.status].label) : 'Not entered'}</span></div>`;

  const cta = $('#td-cta');
  if (t.phase === 'upcoming' && t.isCurrent) {
    cta.innerHTML = `<button class="btn btn--lg" type="button" data-action="join-tournament"
      data-gameweek="${gw}" data-requires-registration
      data-label-open="Apply now — 200 Birr" data-label-closed="Registration closed">
      <span data-btn-label>Apply now — 200 Birr</span></button>`;
  } else {
    cta.innerHTML = `<a class="btn btn--lg btn--ghost btn--ghost-light" href="tournaments.html">Back to tournaments</a>`;
  }

  // Countdown only matters while the gameweek is still open for entries.
  const clockWrap = $('#td-clock-wrap');
  if (t.phase !== 'upcoming') clockWrap.hidden = true;

  hydrateLiveCounts();
  onParticipantsChanged(() => hydrateLiveCounts());
  UI.tabs($('#td-tabs'));

  const lbMount = $('#td-leaderboard');
  lbMount.innerHTML = tableSkeleton(6);
  const data = await DataService.getLeaderboard({ gameweek: gw, size: 25 });
  lbMount.innerHTML = leaderboardTable(data.rows);

  // My performance tab
  const user = Auth.current();
  const perfMount = $('#td-performance');
  if (!user) {
    perfMount.innerHTML = `<div class="empty-state">
      <div class="ico">${icon('user', 26)}</div>
      <h3>Log in to see your performance</h3>
      <p>Your gameweek points, rank and movement appear here once you are signed in.</p>
      <a class="btn" href="login.html">Log in</a></div>`;
  } else if (!entry) {
    perfMount.innerHTML = `<div class="empty-state">
      <div class="ico">${icon('trophy', 26)}</div>
      <h3>You did not enter Gameweek ${gw}</h3>
      <p>Only entered managers are scored in a tournament. The current gameweek is always open from Sunday.</p>
      <a class="btn" href="tournaments.html">See open tournaments</a></div>`;
  } else {
    const you = data.rows.find((r) => r.isYou);
    perfMount.innerHTML = `
      <div class="your-rank-strip">
        <div><span class="mono-label">Tournament rank</span><span class="v">#${you ? you.rank : '—'}</span></div>
        <div><span class="mono-label">GW points</span><span class="v num">${you ? formatNumber(you.gwPoints) : '—'}</span></div>
        <div><span class="mono-label">Total points</span><span class="v num">${you ? formatNumber(you.totalPoints) : '—'}</span></div>
        <div><span class="mono-label">Entry status</span><span class="v" style="font-size:1rem">${escapeHTML(STATUS_BY_KEY[entry.status].label)}</span></div>
      </div>`;
  }
  hydrateIcons();
}

/* =========================== PAGE: NEWS ================================== */

function pageNews() {
  const all = buildNews();
  const mount = $('#news-list');
  const render = (category) => {
    const items = category === 'all' ? all : all.filter((n) => n.category === category);
    mount.innerHTML = items.length
      ? items.map((n, i) => newsCard(n, i === 0 && category === 'all')).join('')
      : `<div class="empty-state" style="grid-column:1/-1">
          <div class="ico">${icon('info', 26)}</div><h3>No stories in this category yet</h3>
          <p>Check back after the next round of team news.</p></div>`;
  };
  render('all');
  UI.tabs($('#news-tabs'), render);
  wireNewsLinks(document);
  hydrateIcons();
}

/* ========================= PAGE: REGISTER ================================ */

const ETHIOPIAN_BANKS = [
  'Commercial Bank of Ethiopia', 'Awash Bank', 'Dashen Bank', 'Bank of Abyssinia',
  'Wegagen Bank', 'United Bank (Hibret)', 'Nib International Bank', 'Cooperative Bank of Oromia',
  'Lion International Bank', 'Zemen Bank', 'Oromia Bank', 'Bunna Bank', 'Berhan Bank',
  'Abay Bank', 'Addis International Bank', 'Debub Global Bank', 'Enat Bank', 'Amhara Bank',
  'Ahadu Bank', 'Goh Betoch Bank', 'Hijra Bank', 'Siinqee Bank', 'Tsehay Bank', 'ZamZam Bank'
];

function pageRegister() {
  const draft = Store.get('registerDraft', { step: 1, personal: {}, reward: { method: 'telebirr' }, fpl: null });
  let step = draft.step || 1;

  const save = () => Store.set('registerDraft', draft);

  const setStep = (n) => {
    step = clamp(n, 1, 3);
    draft.step = step;
    save();
    $$('[data-step-panel]').forEach((p) => { p.hidden = Number(p.dataset.stepPanel) !== step; });
    $$('.stepper-item').forEach((el) => {
      const n2 = Number(el.dataset.step);
      el.dataset.state = n2 === step ? 'current' : n2 < step ? 'done' : 'todo';
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* ---- validation helpers ---- */
  const setError = (input, message) => {
    const field = input.closest('.field');
    const slot = $('.error-text', field);
    if (slot) slot.innerHTML = message ? `${icon('alert', 13)} ${escapeHTML(message)}` : '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    return !message;
  };

  const validators = {
    fullName: (v) => (v.trim().length < 3 ? 'Enter your full name as it appears on your payment account.' : ''),
    age: (v) => {
      const n = Number(v);
      if (!v) return 'Enter your age.';
      if (!Number.isFinite(n) || n < 18) return 'You must be 18 or older to enter a Dil Fantasy tournament.';
      if (n > 100) return 'Enter a valid age.';
      return '';
    },
    phone: (v) => {
      const clean = v.replace(/[\s-]/g, '');
      return /^(\+251|0)9\d{8}$/.test(clean) ? '' : 'Use an Ethiopian mobile number, e.g. +251 912 345 678.';
    },
    email: (v) => (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()) ? '' : 'Enter a valid email address.'),
    password: (v) => (passwordScore(v) < 2 ? 'Use at least 8 characters with a mix of letters and numbers.' : ''),
    confirmPassword: (v) => (v === $('#password').value ? '' : 'The two passwords do not match.')
  };

  function passwordScore(v) {
    let score = 0;
    if (v.length >= 8) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v) && v.length >= 12) score++;
    return score;
  }

  /* ---- Step 1 ---- */
  const step1Fields = ['fullName', 'age', 'phone', 'email', 'password', 'confirmPassword'];
  step1Fields.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    if (draft.personal[id]) input.value = draft.personal[id];
    input.addEventListener('blur', () => setError(input, validators[id](input.value)));
    input.addEventListener('input', () => {
      draft.personal[id] = input.value;
      save();
      if (input.getAttribute('aria-invalid') === 'true') setError(input, validators[id](input.value));
      if (id === 'password') {
        const meter = $('#pw-meter');
        meter.dataset.score = String(passwordScore(input.value));
      }
    });
  });

  $$('.pw-toggle').forEach((btn) => {
    btn.innerHTML = icon('eye', 17);
    btn.addEventListener('click', () => {
      const input = $('input', btn.parentElement);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = icon(showing ? 'eye' : 'eyeOff', 17);
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });

  $('#step1-next').addEventListener('click', () => {
    const ok = step1Fields.map((id) => {
      const input = document.getElementById(id);
      return setError(input, validators[id](input.value));
    }).every(Boolean);
    if (!ok) {
      UI.toast('Check the highlighted fields before continuing.', { type: 'error', title: 'Incomplete form' });
      $('[aria-invalid="true"]').focus();
      return;
    }
    // Uniqueness is enforced by the UNIQUE constraint on users.email; the
    // server reports EMAIL_TAKEN when the account is submitted.
    setStep(2);
  });

  /* ---- Step 2: reward account ---- */
  const bankSelect = $('#bankName');
  bankSelect.innerHTML = '<option value="">Select your bank</option>' +
    ETHIOPIAN_BANKS.map((b) => `<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`).join('');

  const setMethod = (method) => {
    draft.reward.method = method;
    save();
    $$('[data-method]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.method === method)));
    $$('[data-method-panel]').forEach((p) => { p.hidden = p.dataset.methodPanel !== method; });
  };
  $$('[data-method]').forEach((b) => b.addEventListener('click', () => setMethod(b.dataset.method)));
  setMethod(draft.reward.method || 'telebirr');

  ['telebirrAccount', 'cbeAccount', 'bankAccount', 'accountHolder'].forEach((id) => {
    const input = document.getElementById(id);
    if (input && draft.reward[id]) input.value = draft.reward[id];
    if (input) input.addEventListener('input', () => { draft.reward[id] = input.value; save(); });
  });
  if (draft.reward.bankName) bankSelect.value = draft.reward.bankName;
  bankSelect.addEventListener('change', () => { draft.reward.bankName = bankSelect.value; save(); });

  $('#step2-back').addEventListener('click', () => setStep(1));
  $('#step2-next').addEventListener('click', () => {
    const m = draft.reward.method;
    let input, message = '';
    if (m === 'telebirr') {
      input = $('#telebirrAccount');
      message = /^(\+251|0)?9\d{8}$/.test(input.value.replace(/[\s-]/g, '')) ? '' : 'Enter the Telebirr number that receives your rewards.';
    } else if (m === 'cbe') {
      input = $('#cbeAccount');
      message = /^\d{10,16}$/.test(input.value.replace(/\s/g, '')) ? '' : 'A CBE account number is 13 digits.';
    } else {
      input = $('#bankAccount');
      if (!bankSelect.value) { setError(bankSelect, 'Choose your bank.'); return; }
      setError(bankSelect, '');
      message = input.value.trim().length >= 6 ? '' : 'Enter your account number.';
      if (!message && $('#accountHolder').value.trim().length < 3) {
        setError($('#accountHolder'), 'Enter the account holder name.');
        return;
      }
      setError($('#accountHolder'), '');
    }
    if (!setError(input, message)) return;
    setStep(3);
  });

  /* ---- Step 3: connect FPL ---- */
  const idInput = $('#managerId');
  const fplResult = $('#fpl-result');

  $('#fpl-help').addEventListener('click', (e) => {
    e.preventDefault();
    UI.modal({
      title: 'Where to find your FPL Manager ID',
      body: `<ol class="payment-steps">
        <li>Log in at the official Fantasy Premier League site.</li>
        <li>Open the <strong>Points</strong> or <strong>Gameweek History</strong> page for your team.</li>
        <li>Look at the address bar — the number in the link is your Manager ID.</li>
        <li>Copy just the digits, for example <code>4271839</code>.</li>
      </ol>
      <div class="notice notice--purple">${icon('lock', 18)}
        <div>Dil Fantasy only reads public performance data for that ID. Never share your FPL password
        with anyone, including us.</div></div>`,
      footer: `<button class="btn" type="button" data-close>Got it</button>`
    });
  });

  $('#connect-fpl').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    fplResult.innerHTML = `<div class="notice">${icon('refresh', 18)}
      <div><strong>Connecting to Fantasy Premier League…</strong><br>
      <span style="font-size:.82rem">Fetching the public profile for that Manager ID.</span></div></div>`;
    UI.loading(btn, true, 'Connecting');
    try {
      const fpl = await FPLService.connectFPLAccount(idInput.value);
      draft.fpl = fpl;
      save();
      setError(idInput, '');
      fplResult.innerHTML = `
        <div class="fpl-connected">
          <p class="head">${icon('check', 18)} FPL account connected</p>
          <div class="fpl-stats">
            <div><div class="k">Manager</div><div class="v">${escapeHTML(fpl.managerName)}</div></div>
            <div><div class="k">FPL team</div><div class="v">${escapeHTML(fpl.teamName)}</div></div>
            <div><div class="k">Manager ID</div><div class="v num">${escapeHTML(fpl.managerId)}</div></div>
            <div><div class="k">Overall rank</div><div class="v num">${formatNumber(fpl.overallRank)}</div></div>
            <div><div class="k">Total points</div><div class="v num">${formatNumber(fpl.totalPoints)}</div></div>
            <div><div class="k">Team value</div><div class="v num">£${fpl.teamValue}m</div></div>
          </div>
          <div style="margin-top:14px" class="row-between">
            <span class="mono-label">Gameweek points: ${formatNumber(fpl.gameweekPoints)}</span>
            <button class="btn btn--sm btn--ghost" type="button" id="fpl-change">Use a different ID</button>
          </div>
        </div>`;
      $('#finish-register').disabled = false;
      $('#fpl-change').addEventListener('click', () => {
        draft.fpl = null; save();
        fplResult.innerHTML = '';
        $('#finish-register').disabled = true;
        idInput.focus();
      });
    } catch (err) {
      const reason = err.code === 'NOT_FOUND'
        ? 'That Manager ID does not match an FPL account.'
        : err.message;
      fplResult.innerHTML = `
        <div class="notice notice--danger">${icon('alert', 18)}
          <div><strong>We couldn't connect your FPL account.</strong>
            <ul style="margin:8px 0 0;padding-left:16px;list-style:disc">
              <li>The Manager ID may be incorrect — ${escapeHTML(reason)}</li>
              <li>The account may not exist for this season.</li>
              <li>The FPL service may be temporarily unavailable.</li>
            </ul>
          </div>
        </div>
        <div class="form-actions" style="margin-top:14px">
          <button class="btn btn--ghost" type="button" id="fpl-check">Check Manager ID</button>
          <button class="btn" type="button" id="fpl-retry">Try again</button>
        </div>`;
      $('#fpl-retry').addEventListener('click', () => { idInput.focus(); fplResult.innerHTML = ''; });
      $('#fpl-check').addEventListener('click', () => $('#fpl-help').click());
      $('#finish-register').disabled = true;
    } finally {
      UI.loading(btn, false);
    }
  });

  $('#step3-back').addEventListener('click', () => setStep(2));

  $('#finish-register').addEventListener('click', async (e) => {
    if (!draft.fpl) {
      UI.toast('Connect your FPL Manager ID to finish.', { type: 'error', title: 'One step left' });
      return;
    }
    const btn = e.currentTarget;
    UI.loading(btn, true, 'Creating account');
    try {
      const reward = draft.reward.method === 'telebirr'
        ? { method: 'telebirr', accountNumber: draft.reward.telebirrAccount }
        : draft.reward.method === 'cbe'
          ? { method: 'cbe', accountNumber: draft.reward.cbeAccount }
          : { method: 'bank', bankName: draft.reward.bankName,
              accountNumber: draft.reward.bankAccount, accountName: draft.reward.accountHolder };

      const user = await Auth.register({
        fullName: draft.personal.fullName,
        age: draft.personal.age,
        phone: draft.personal.phone,
        email: draft.personal.email,
        password: draft.personal.password,
        reward
      });
      // The FPL Manager ID is a separate column update once the row exists.
      await Auth.update({ fpl: draft.fpl });
      Store.remove('registerDraft');
      showWelcome(Auth.current());
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') {
        setStep(1);
        setError($('#email'), err.message);
      }
      UI.toast(err.message, { type: 'error', title: 'Could not create account' });
    } finally {
      UI.loading(btn, false);
    }
  });

  function showWelcome(user) {
    const state = Tournament.state();
    $('#register-flow').hidden = true;
    const welcome = $('#register-welcome');
    welcome.hidden = false;
    welcome.innerHTML = `
      <div class="card card--pad">
        <span class="badge badge--green">Account created</span>
        <h1 style="margin:16px 0 10px;font-size:clamp(1.8rem,4vw,2.6rem)">Welcome to Dil Fantasy, ${escapeHTML(user.fullName.split(' ')[0])}!</h1>
        <p class="text-soft" style="margin-bottom:22px">Your account is ready. Here is what we have on file.</p>
        <p class="mono-label" style="margin-bottom:10px">Your account</p>
        <div class="info-list">
          <div><span class="k">Name</span><span class="v">${escapeHTML(user.fullName)}</span></div>
          <div><span class="k">FPL team</span><span class="v">${escapeHTML(user.fpl.teamName)}</span></div>
          <div><span class="k">Manager ID</span><span class="v num">${escapeHTML(user.fpl.managerId)}</span></div>
          <div><span class="k">Overall rank</span><span class="v num">${formatNumber(user.fpl.overallRank)}</span></div>
          <div><span class="k">Total points</span><span class="v num">${formatNumber(user.fpl.totalPoints)}</span></div>
          <div><span class="k">Reward method</span><span class="v masked">${escapeHTML(rewardSummary(user.reward))}</span></div>
        </div>
        <div class="notice notice--purple" style="margin-top:18px">${icon('lock', 18)}
          <div>Your reward and contact details stay private. They never appear on the leaderboard or the
          participant directory.</div></div>
        <div class="form-actions">
          <a class="btn btn--ghost" href="dashboard.html">Go to dashboard</a>
          <a class="btn" href="tournament.html?gw=${state.gameweek}">View this week's tournament</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderHeader();
  }

  // Restore a connected FPL account from the draft.
  if (draft.fpl) {
    idInput.value = draft.fpl.managerId;
    $('#connect-fpl').click();
  }
  setStep(step);
  hydrateIcons();
}

/* ============================ PAGE: LOGIN =============================== */

function pageLogin() {
  $$('.pw-toggle').forEach((btn) => {
    btn.innerHTML = icon('eye', 17);
    btn.addEventListener('click', () => {
      const input = $('input', btn.parentElement);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = icon(showing ? 'eye' : 'eyeOff', 17);
    });
  });

  $('#login-btn').addEventListener('click', async (e) => {
    const email = $('#login-email').value;
    const password = $('#login-password').value;
    const errSlot = $('#login-error');
    errSlot.innerHTML = '';
    if (!email || !password) {
      errSlot.innerHTML = `${icon('alert', 13)} Enter your email and password.`;
      return;
    }
    const btn = e.currentTarget;
    UI.loading(btn, true, 'Signing in');
    try {
      await Auth.login(email, password);
      const dest = Store.get('redirectAfterLogin', 'dashboard.html');
      Store.remove('redirectAfterLogin');
      window.location.href = dest;
    } catch (err) {
      errSlot.innerHTML = `${icon('alert', 13)} ${escapeHTML(err.message)}`;
      UI.loading(btn, false);
    }
  });

  $('#login-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('#login-btn').click(); }
  });
  hydrateIcons();
}

/* ========================== PAGE: DASHBOARD ============================= */

async function pageDashboard() {
  const user = Auth.current();
  if (!requirePage(user)) return;
  const state = Tournament.state();
  $('#dash-greeting').textContent = `Welcome back, ${user.fullName.split(' ')[0]}`;
  $('#dash-sub').textContent = user.fpl
    ? `${user.fpl.teamName} • Manager ID ${user.fpl.managerId}`
    : 'Connect your FPL Manager ID to start scoring.';

  /* ITEM 5 — one aggregated call, GET /users/:id/dashboard, plus the
     per-gameweek history for the chart. Every figure below is a SUM or a
     COUNT over this account's rows, so the tiles grow as the season runs.
     The gameweek number comes from gameweeks.gw_number, never client maths. */
  $('#dash-stats').innerHTML = Array.from({ length: 5 }, () =>
    '<div class="stat-tile"><span class="skeleton" style="width:70%"></span>' +
    '<span class="skeleton" style="width:45%;height:26px;margin-top:12px"></span></div>').join('');

  let dashboard;
  let performance;
  try {
    [dashboard, performance] = await Promise.all([
      DataService.getDashboard(user.id),
      DataService.getPerformance(user.id)
    ]);
  } catch (err) {
    $('#dash-stats').innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ico">${icon('alert', 24)}</div>
      <h3>Your dashboard could not be loaded</h3>
      <p>${escapeHTML(err.message || 'The server did not respond.')}</p>
      <button class="btn btn--ghost" type="button" onclick="window.location.reload()">Try again</button>
    </div>`;
    hydrateIcons();
    return;
  }

  const st = dashboard.stats;
  const gwNumber = dashboard.currentGameweek;
  const scoredRows = performance.rows.filter((r) => r.played && r.gwPoints != null);

  $('#dash-stats').innerHTML = [
    { label: 'Current rank', value: st.currentRank ? `#${st.currentRank}` : '—', tone: '' },
    { label: `Gameweek ${gwNumber} points`,
      value: st.gwPoints != null ? formatNumber(st.gwPoints) : '—', tone: '' },
    { label: 'Tournament points', value: formatNumber(st.totalPoints), tone: 'stat-tile--purple' },
    { label: 'Gameweeks played', value: formatNumber(st.confirmedEntries), tone: 'stat-tile--purple' },
    { label: 'Total winnings', value: formatBirr(st.winningsPaid), tone: 'stat-tile--neutral' }
  ].map((s) => `
    <div class="stat-tile ${s.tone}">
      <span class="mono-label">${s.label}</span>
      <div class="value">${s.value}</div>
    </div>`).join('');

  /* This week's tournament card */
  let unsubscribeEntryClock = null;
  const paintEntryCard = () => {
    const e2 = Entries.forGameweek(state.gameweek);
    const s2 = e2 ? STATUS_BY_KEY[e2.status] : null;
    $('#dash-tournament').innerHTML = `
      <div class="row-between" style="margin-bottom:6px">
        <span class="mono-label">This week</span>
        <span class="badge badge--${s2 ? s2.tone : 'outline'}">${s2 ? s2.label : 'Not registered'}</span>
      </div>
      <h2 style="font-size:1.8rem;margin-bottom:6px">Gameweek ${state.gameweek}</h2>
      <p style="color:rgba(255,255,255,.62);font-size:.9rem;margin-bottom:16px" data-clock-note>—</p>
      <div class="clockface" style="margin-bottom:14px">
        <div class="clock-unit"><span class="val"><span data-clock-days>00</span><sup>D</sup></span><span class="lbl">Days</span></div>
        <span class="clock-sep" aria-hidden="true">:</span>
        <div class="clock-unit"><span class="val"><span data-clock-hours>00</span><sup>H</sup></span><span class="lbl">Hours</span></div>
        <span class="clock-sep" aria-hidden="true">:</span>
        <div class="clock-unit"><span class="val"><span data-clock-minutes>00</span><sup>M</sup></span><span class="lbl">Min</span></div>
        <span class="clock-sep" aria-hidden="true">:</span>
        <div class="clock-unit"><span class="val"><span data-clock-seconds>00</span><sup>S</sup></span><span class="lbl">Sec</span></div>
      </div>
      <div class="clock-rail"><span data-clock-rail></span></div>
      ${s2 && s2.key === 'confirmed'
        ? `<a class="btn btn--block btn--ghost btn--ghost-light" href="tournament.html?gw=${state.gameweek}">View tournament</a>`
        : `<button class="btn btn--block" type="button" data-action="join-tournament"
             data-gameweek="${state.gameweek}" data-requires-registration
             data-label-open="Join tournament — 200 Birr" data-label-closed="Registration closed">
             <span data-btn-label>Join tournament — 200 Birr</span></button>`}
      ${e2 && e2.status === PAYMENT_STATUS.UNDER_REVIEW.key ? `
        <button class="btn btn--sm btn--ghost btn--ghost-light btn--block" style="margin-top:10px" type="button" id="demo-verify">
          Simulate administrator verification
        </button>` : ''}`;

    const demoBtn = $('#demo-verify');
    if (demoBtn) {
      demoBtn.addEventListener('click', async (ev) => {
        // POST /registrations/:id/verify — a real UPDATE on the row.
        UI.loading(ev.currentTarget, true, 'Verifying');
        try {
          await Entries.verify(state.gameweek, true);
          UI.toast(`Gameweek ${state.gameweek} registration confirmed.`, { title: 'Payment verified' });
          paintEntryCard();
        } catch (err) {
          UI.toast(err.message || 'That could not be verified.', {
            type: 'error', title: 'Verification failed'
          });
          UI.loading(ev.currentTarget, false);
        }
      });
    }
    // Re-bind the freshly rendered clock nodes, dropping the previous binding.
    if (unsubscribeEntryClock) unsubscribeEntryClock();
    unsubscribeEntryClock = ClockBus.subscribe((s) => paintClock($('#dash-tournament'), s));
  };
  paintEntryCard();

  /* Points chart — one point per Dil Fantasy gameweek, beginning at
     Gameweek 1 and extending by one each week as scores are published. */
  const chartMount = $('#dash-chart');
  if (!user.fpl) {
    chartMount.innerHTML = `<div class="empty-state">
      <div class="ico">${icon('link', 26)}</div><h3>No FPL account connected</h3>
      <p>Add your Manager ID so Dil Fantasy can read your official gameweek scores.</p>
      <a class="btn" href="profile.html#fpl">Connect FPL account</a></div>`;
  } else if (!scoredRows.length) {
    // Honest empty state: the season has not produced a published score yet.
    const joined = Entries.forGameweek(state.gameweek);
    chartMount.innerHTML = `<div class="empty-state">
      <div class="ico">${icon('chart', 26)}</div>
      <h3>Your first result lands after Gameweek ${gwNumber}</h3>
      <p>${joined
        ? `Gameweek ${state.gameweek} points are published once the gameweek finishes. This chart then adds a point for every gameweek you play.`
        : `Join Gameweek ${state.gameweek} to start the chart. A point is added for every gameweek you play.`}</p>
      ${joined ? '' : `<button class="btn" type="button" data-action="join-tournament"
        data-gameweek="${state.gameweek}" data-requires-registration
        data-label-open="Apply now" data-label-closed="Registration closed">
        <span data-btn-label>Apply now</span></button>`}</div>`;
  } else {
    const series = scoredRows.map((r) => ({ label: `GW${r.gwNumber}`, value: r.gwPoints }));
    lineChart(chartMount, series, { height: 200, name: 'Gameweek points' });
  }
  

  /* Recent entries */
  const history = Entries.history().slice(0, 5);
  $('#dash-entries').innerHTML = history.length ? history.map((e2) => {
    const s2 = STATUS_BY_KEY[e2.status];
    return `<div class="timeline-item">
      <div class="timeline-gw"><b>GW ${e2.gwNumber}</b>${EAT.shortDate(e2.submittedAt)}</div>
      <div class="row-between">
        <div><strong>${e2.entryFee} Birr entry</strong>
        <p style="font-size:.84rem;color:var(--text-soft);margin:2px 0 0">
          ${e2.status === 'awaiting_proof' ? 'Proof not sent yet' : statusOf(e2.status).note}</p></div>
        <div class="row-end">
          ${e2.status === 'awaiting_proof' ? `<button class="btn btn--ghost btn--sm" type="button"
            data-action="resume-proof" data-gameweek="${e2.gwNumber}">
            ${icon('telegram', 15)} Submit proof</button>` : ''}
          <span class="badge badge--${s2.tone}">${s2.label}</span>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state" style="padding:34px 16px">
      <div class="ico">${icon('history', 24)}</div>
      <h3 style="font-size:1.05rem">No entries yet</h3>
      <p>Your tournament entries and their verification status will be listed here.</p>
    </div>`;

  /* Leaderboard snapshot — GET /leaderboard, the same query the
     leaderboard page uses, so the two can never disagree. */
  const snapshotMount = $('#dash-leaderboard');
  snapshotMount.innerHTML = tableSkeleton(6);
  try {
    const lb = await DataService.getLeaderboard({ gameweek: gwNumber, size: 6 });
    snapshotMount.innerHTML = lb.rows.length
      ? leaderboardTable(lb.rows, { compact: true })
      : `<div class="empty-state" style="padding:30px 16px">
           <div class="ico">${icon('trophy', 24)}</div>
           <h3 style="font-size:1.05rem">No standings yet</h3>
           <p>Rankings appear once official scores are published for Gameweek ${gwNumber}.</p>
         </div>`;
  } catch (err) {
    snapshotMount.innerHTML = `<div class="empty-state" style="padding:30px 16px">
      <div class="ico">${icon('alert', 24)}</div>
      <h3 style="font-size:1.05rem">Standings unavailable</h3>
      <p>${escapeHTML(err.message || 'The server did not respond.')}</p></div>`;
  }
  hydrateIcons();
}

/* ========================= PAGE: PERFORMANCE ============================= */

async function pagePerformance() {
  const user = Auth.current();
  if (!requirePage(user)) return;
  if (!user.fpl) {
    $('#perf-body').innerHTML = `<div class="empty-state">
      <div class="ico">${icon('chart', 26)}</div>
      <h3>Connect your FPL account to see analytics</h3>
      <p>Points progression, rank movement and tournament results all come from your official FPL data.</p>
      <a class="btn" href="profile.html#fpl">Connect FPL account</a></div>`;
    hydrateIcons();
    return;
  }

  /* ITEM 5 — GET /users/:id/performance returns one row per gameweek from
     gw_number 1 to the current one. Nothing here is a static array. */
  $('#perf-stats').innerHTML = Array.from({ length: 6 }, () =>
    '<div class="stat-tile"><span class="skeleton" style="width:70%"></span>' +
    '<span class="skeleton" style="width:45%;height:26px;margin-top:12px"></span></div>').join('');

  let data;
  try {
    data = await DataService.getPerformance(user.id);
  } catch (err) {
    $('#perf-stats').innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="ico">${icon('alert', 24)}</div>
      <h3>Performance data could not be loaded</h3>
      <p>${escapeHTML(err.message || 'The server did not respond.')}</p>
      <button class="btn btn--ghost" type="button" id="perf-retry">Try again</button></div>`;
    const retry = $('#perf-retry');
    if (retry) retry.addEventListener('click', () => pagePerformance());
    hydrateIcons();
    return;
  }

  const scored = data.rows.filter((r) => r.gwPoints != null);
  const played = data.rows.filter((r) => r.played);
  const best = scored.reduce((acc, r) => (!acc || r.gwPoints > acc.gwPoints ? r : acc), null);
  const latest = scored.length ? scored[scored.length - 1] : null;
  const average = scored.length
    ? Math.round(scored.reduce((sum, r) => sum + r.gwPoints, 0) / scored.length) : 0;
  const winnings = data.rows.reduce(
    (sum, r) => sum + (r.rewardStatus === 'paid' ? r.winnings : 0), 0);

  $('#perf-stats').innerHTML = [
    { k: 'Average gameweek points', v: scored.length ? formatNumber(average) : '—' },
    { k: 'Highest scoring gameweek',
      v: best ? `GW ${best.gwNumber} · ${best.gwPoints}` : '—', tone: 'stat-tile--purple' },
    { k: 'Overall rank', v: latest && latest.overallRank ? formatNumber(latest.overallRank) : '—' },
    { k: 'Tournament entries', v: formatNumber(data.rows.filter((r) => r.registrationStatus).length),
      tone: 'stat-tile--purple' },
    { k: 'Tournaments confirmed', v: formatNumber(played.length), tone: 'stat-tile--neutral' },
    { k: 'Total winnings', v: formatBirr(winnings), tone: 'stat-tile--neutral' }
  ].map((s) => `<div class="stat-tile ${s.tone || ''}">
      <span class="mono-label">${s.k}</span><div class="value">${s.v}</div></div>`).join('');

  /* Charts run on gw_number, so every series starts at Gameweek 1. */
  const emptyChart = (mount, title, body) => {
    mount.innerHTML = `<div class="empty-state" style="padding:36px 16px">
      <div class="ico">${icon('chart', 24)}</div>
      <h3 style="font-size:1.05rem">${title}</h3><p>${body}</p></div>`;
  };

  if (scored.length) {
    lineChart($('#chart-points'),
      scored.map((r) => ({ label: `GW${r.gwNumber}`, value: r.gwPoints })),
      { height: 220, name: 'Gameweek points' });
  } else {
    emptyChart($('#chart-points'), 'No published scores yet',
      `Points appear here once Gameweek ${data.currentGameweek} is scored.`);
  }

  const ranked = scored.filter((r) => r.overallRank != null);
  if (ranked.length) {
    lineChart($('#chart-rank'),
      ranked.map((r) => ({ label: `GW${r.gwNumber}`, value: r.overallRank })), {
        height: 220, color: 'var(--purple-600)', fill: 'rgba(124,58,237,.12)', invert: true,
        name: 'Overall rank',
        valueFormat: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : formatNumber(v))
      });
  } else {
    emptyChart($('#chart-rank'), 'No rank history yet',
      'Your overall rank is recorded each time a gameweek is scored.');
  }

  const tournamentSeries = played
    .filter((r) => r.gwPoints != null)
    .slice(-8)
    .map((r) => ({ label: `GW${r.gwNumber}`, value: r.gwPoints, highlight: true }));
  if (tournamentSeries.length) {
    barChart($('#chart-tournaments'), tournamentSeries, { name: 'Tournament points' });
  } else {
    $('#chart-tournaments').innerHTML = `<div class="empty-state" style="padding:36px 16px">
      <div class="ico">${icon('trophy', 24)}</div>
      <h3 style="font-size:1.05rem">No tournament results yet</h3>
      <p>Enter a gameweek tournament and your scored results will be charted here.</p>
      <a class="btn btn--sm" href="tournaments.html">See open tournaments</a></div>`;
  }

  const refresh = $('#perf-refresh');
  if (refresh) {
    refresh.addEventListener('click', async (e) => {
      UI.loading(e.currentTarget, true, 'Refreshing');
      try {
        await Auth.refresh();
        await pagePerformance();
        UI.toast('Latest data loaded.', { title: 'Refreshed' });
      } catch (err) {
        UI.toast('Could not refresh right now.', { type: 'error', title: 'Refresh failed' });
      } finally {
        UI.loading(e.currentTarget, false);
      }
    });
  }
  hydrateIcons();
}

/* =========================== PAGE: PROFILE ============================== */

function pageProfile() {
  const user = Auth.current();
  if (!requirePage(user)) return;

  $('#profile-avatar').textContent = initials(user.fullName);
  $('#profile-name').textContent = user.fullName;
  $('#profile-team').textContent = user.fpl ? `${user.fpl.teamName} • Manager ID ${user.fpl.managerId}` : 'FPL account not connected';

  $('#personal-info').innerHTML = `
    <div><span class="k">Full name</span><span class="v">${escapeHTML(user.fullName)}</span></div>
    <div><span class="k">Age</span><span class="v">${escapeHTML(String(user.age))}</span></div>
    <div><span class="k">Phone</span><span class="v masked">${maskAccount(user.phone)}</span></div>
    <div><span class="k">Email</span><span class="v">${escapeHTML(user.email)}</span></div>`;

  const fplBox = $('#fpl-info');
  const paintFpl = () => {
    const u = Auth.current();
    if (u.fpl) {
      fplBox.innerHTML = `
        <div class="info-list">
          <div><span class="k">Manager ID</span><span class="v num">${escapeHTML(u.fpl.managerId)}</span></div>
          <div><span class="k">FPL team</span><span class="v">${escapeHTML(u.fpl.teamName)}</span></div>
          <div><span class="k">Manager name</span><span class="v">${escapeHTML(u.fpl.managerName)}</span></div>
          <div><span class="k">Overall rank</span><span class="v num">${formatNumber(u.fpl.overallRank)}</span></div>
          <div><span class="k">Total points</span><span class="v num">${formatNumber(u.fpl.totalPoints)}</span></div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn btn--sm btn--ghost" type="button" id="fpl-refresh">${icon('refresh', 15)} Refresh data</button>
          <span id="fpl-source"></span>
        </div>`;
      $('#fpl-refresh').addEventListener('click', async (e) => {
        UI.loading(e.currentTarget, true, 'Refreshing');
        try { await Auth.refresh(); UI.toast('Account data refreshed.'); paintFpl(); }
        catch (err) { UI.toast('Could not reach the FPL service.', { type: 'error' }); }
        finally { UI.loading(e.currentTarget, false); }
      });
    } else {
      fplBox.innerHTML = `
        <div class="field">
          <label for="profile-manager-id">FPL Manager ID</label>
          <input id="profile-manager-id" type="text" inputmode="numeric" placeholder="Enter your FPL Manager ID">
          <p class="error-text"></p>
        </div>
        <button class="btn" type="button" id="profile-connect">Connect FPL account</button>`;
      $('#profile-connect').addEventListener('click', async (e) => {
        UI.loading(e.currentTarget, true, 'Connecting');
        try {
          const fpl = await FPLService.connectFPLAccount($('#profile-manager-id').value);
          Auth.update({ fpl });
          UI.toast('FPL account connected.', { title: 'Connected' });
          paintFpl();
          renderHeader();
        } catch (err) {
          $('.error-text', fplBox).innerHTML = `${icon('alert', 13)} ${escapeHTML(err.message)}`;
        } finally {
          UI.loading(e.currentTarget, false);
        }
      });
    }
    hydrateIcons(fplBox);
  };
  paintFpl();

  $('#reward-info').innerHTML = `
    <div><span class="k">Reward method</span><span class="v masked">${escapeHTML(rewardSummary(user.reward))}</span></div>
    <div><span class="k">Visibility</span><span class="v">Private — never shown publicly</span></div>`;

  const history = Entries.history();
  $('#tournament-history').innerHTML = history.length ? history.map((e) => {
    const s = STATUS_BY_KEY[e.status];
    return `<div class="timeline-item">
      <div class="timeline-gw"><b>GW ${e.gwNumber}</b>${EAT.shortDate(e.submittedAt)}</div>
      <div class="row-between">
        <div><strong>${e.entryFee} Birr entry</strong>
          <p style="font-size:.84rem;color:var(--text-soft);margin:2px 0 0">
            ${e.verifiedAt ? `Reviewed ${EAT.shortDate(e.verifiedAt)}` : e.status === 'awaiting_proof' ? 'Proof not sent yet' : statusOf(e.status).note}</p>
        </div>
        <div class="row">
          <span class="badge badge--${s.tone}">${s.label}</span>
          <a class="btn btn--sm btn--ghost" href="tournament.html?gw=${e.gameweek}">View</a>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state" style="padding:34px 16px">
      <div class="ico">${icon('history', 24)}</div>
      <h3 style="font-size:1.05rem">No tournaments entered yet</h3>
      <p>Every entry you make, and its verification status, is recorded here.</p>
      <a class="btn btn--sm" href="tournaments.html">Browse tournaments</a></div>`;

  $('#logout-all').addEventListener('click', () => {
    UI.modal({
      title: 'Log out of Dil Fantasy?',
      body: '<p>You will need your email and password to sign back in.</p>',
      footer: `<button class="btn btn--ghost" type="button" data-close>Stay signed in</button>
               <button class="btn btn--purple" type="button" data-action="logout">Log out</button>`
    });
  });
  hydrateIcons();
}

/* =========================== PAGE: REWARDS ============================== */

function pageRewards() {
  const user = Auth.current();
  if (!requirePage(user)) return;
  const totals = rewardTotals(user);
  const rewards = user.rewards || [];

  $('#rewards-summary').innerHTML = [
    { k: 'Total winnings', v: formatBirr(totals.paid + totals.pending) },
    { k: 'Pending rewards', v: formatBirr(totals.pending), tone: 'stat-tile--purple' },
    { k: 'Paid rewards', v: formatBirr(totals.paid), tone: 'stat-tile--neutral' }
  ].map((s) => `<div class="stat-tile ${s.tone || ''}">
      <span class="mono-label">${s.k}</span><div class="value">${s.v}</div></div>`).join('');

  $('#reward-method').innerHTML = `
    <div><span class="k">Paid to</span><span class="v masked">${escapeHTML(rewardSummary(user.reward))}</span></div>
    <div><span class="k">Status</span><span class="v">Verified for payouts</span></div>`;

  $('#reward-history').innerHTML = rewards.length ? rewards.map((r) => `
    <div class="reward-row">
      <div>
        <strong>Gameweek ${r.gwNumber}</strong>
        <p style="font-size:.85rem;color:var(--text-soft);margin:2px 0 0">${r.paidAt ? EAT.shortDate(r.paidAt) : 'Awaiting payout'}</p>
      </div>
      <div style="text-align:right">
        <div class="reward-amount">${formatBirr(r.amount)}</div>
        <span class="badge badge--${r.status === 'paid' ? 'green-soft' : 'purple-soft'}">${r.status === 'paid' ? 'Paid' : 'Pending'}</span>
      </div>
    </div>`).join('') : `
    <div class="empty-state">
      <div class="ico">${icon('gift', 26)}</div>
      <h3>No rewards yet</h3>
      <p>Finish inside the paying positions of a gameweek tournament and your reward appears here,
      along with its payout status.</p>
      <a class="btn" href="tournaments.html">See this week's tournament</a>
    </div>`;
  hydrateIcons();
}

/* ====================== PAGE: STATIC CONTENT ============================ */

function pageStatic() {
  hydrateIcons();
  const faqs = $$('[data-faq]');
  faqs.forEach((item) => {
    const btn = $('button', item);
    const body = $('[data-faq-body]', item);
    if (!btn || !body) return;
    body.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    });
  });
}

/* ============================= DISPATCH ================================= */

function initPage() {
  const page = document.body.dataset.page;
  const routes = {
    home: pageHome,
    leaderboard: pageLeaderboard,
    tournaments: pageTournaments,
    tournament: pageTournamentDetail,
    news: pageNews,
    register: pageRegister,
    login: pageLogin,
    dashboard: pageDashboard,
    performance: pagePerformance,
    profile: pageProfile,
    rewards: pageRewards,
    'how-it-works': pageStatic,
    rules: pageStatic
  };
  const run = routes[page] || pageStatic;
  try {
    const result = run();
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error('[Dil Fantasy] Page error:', err);
        UI.toast('Something did not load correctly. Reload the page to try again.', { type: 'error', title: 'Load error' });
      });
    }
  } catch (err) {
    console.error('[Dil Fantasy] Page error:', err);
  }
}
