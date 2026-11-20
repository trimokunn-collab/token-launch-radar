// Token Launch Radar — the page. Renders the board data.js carries, fully
// offline. It also recomputes every implied value from the model in the open:
// the same arithmetic lib/model.ts ran, so a reader can watch the page and
// board.json agree, number for number.

'use strict';

const DATA = window.TOKEN_RADAR;
const ROWS = DATA.rows;
const bySlug = new Map(ROWS.map((r) => [r.slug, r]));

const state = {
  q: '',
  category: '',
  chain: '',
  tier: '',
  watch: false,
  sort: 'rank',
  dir: 1,
};

/* ---------- formatting ---------- */

function fmtUsd(usd) {
  if (usd >= 1_000_000_000) return '$' + (usd / 1_000_000_000).toFixed(2) + 'B';
  if (usd >= 1_000_000) return '$' + (usd / 1_000_000).toFixed(1) + 'M';
  if (usd >= 1_000) return '$' + (usd / 1_000).toFixed(1) + 'K';
  return '$' + usd;
}

function fmtFull(usd) {
  return '$' + usd.toLocaleString('en-US');
}

function fmtPct(change) {
  if (change === null) return '\u2014';
  const sign = change > 0 ? '+' : '';
  return sign + change.toFixed(1) + '%';
}

function fmtAge(days) {
  if (days === null) return 'unreported';
  if (days < 365) return days + ' days';
  return (days / 365.25).toFixed(1) + ' years';
}

/* ---------- the model, recomputed in the open ---------- */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function growthFactor(change) {
  if (change === null) return 1;
  const pct = clamp(change, -60, 150);
  return clamp(1 + (pct / 100) * 0.3, 0.8, 1.45);
}

function maturityFactor(ageDays) {
  if (ageDays === null) return 0.95;
  return 0.85 + 0.075 * Math.min(ageDays / 365.25, 3);
}

function breadthFactor(chainCount) {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 5);
}

function impliedOf(row) {
  const raw =
    row.tvl_usd * row.ratio * growthFactor(row.change_7d) * maturityFactor(row.age_days) * breadthFactor(row.chains.length);
  return Math.max(1, Math.round(raw));
}

/* ---------- tiny DOM helper ---------- */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
  }
  for (const child of children || []) {
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/* ---------- masthead + method ---------- */

function renderStats() {
  const host = document.getElementById('masthead-stats');
  const stats = [
    [String(DATA.stats.candidates), 'pre-token ranked'],
    [DATA.stats.watchlist_covered + '/' + DATA.stats.watchlist_size, 'watchlist covered'],
    [String(DATA.stats.protocols_scanned), 'protocols scanned'],
    [fmtUsd(DATA.stats.total_implied_usd), 'total implied'],
    [DATA.as_of, 'snapshot date'],
  ];
  for (const [value, label] of stats) {
    host.append(el('div', { class: 'stat' }, [el('b', { text: value }), el('span', { text: label })]));
  }
  const method = document.getElementById('method');
  method.append(
    el('h2', { text: 'How the radar prices a launch that has not happened' }),
    el('p', { text: DATA.model.summary }),
    el('p', {}, [
      'In one line: ',
      el('code', { text: 'implied = TVL x peer ratio x momentum x track record x chain breadth' }),
      ' \u2014 model ' + DATA.model.version + ', global peer ratio ' + DATA.model.global_ratio.toFixed(3) +
        '. Open any protocol: the page recomputes its value from these inputs and shows it beside the number board.json carries.',
    ]),
  );
}

/* ---------- filters ---------- */

function fillFilters() {
  const categories = [...new Set(ROWS.map((r) => r.category).filter((c) => c !== null))].sort();
  const catSel = document.getElementById('f-category');
  for (const c of categories) catSel.append(el('option', { value: c, text: c }));
  const chains = [...new Set(ROWS.flatMap((r) => r.chains))].sort();
  const chainSel = document.getElementById('f-chain');
  for (const c of chains) chainSel.append(el('option', { value: c, text: c }));
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = ROWS.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.tier && r.tier !== state.tier) return false;
    if (state.watch && !r.in_watchlist) return false;
    return true;
  });
  const tierOrder = { S: 0, A: 1, B: 2, C: 3 };
  rows = [...rows].sort((a, b) => {
    let cmp;
    if (state.sort === 'name' || state.sort === 'category') {
      cmp = String(a[state.sort] || '').localeCompare(String(b[state.sort] || ''));
    } else if (state.sort === 'tier') {
      cmp = tierOrder[a.tier] - tierOrder[b.tier];
    } else if (state.sort === 'change_7d') {
      cmp = (a.change_7d ?? -Infinity) - (b.change_7d ?? -Infinity);
    } else {
      cmp = a[state.sort] - b[state.sort];
    }
    if (cmp === 0) cmp = a.rank - b.rank;
    return cmp * state.dir;
  });
  return rows;
}

/* ---------- board ---------- */

function renderBoard() {
  const body = document.getElementById('board-body');
  body.textContent = '';
  const rows = visibleRows();
  document.getElementById('row-count').textContent = rows.length + ' of ' + ROWS.length + ' protocols';
  document.getElementById('board-empty').hidden = rows.length !== 0;
  for (const r of rows) {
    const change = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
    const confBar = el('span', { class: 'conf-bar' }, [el('i', {})]);
    confBar.firstChild.style.width = r.confidence + '%';
    const tr = el('tr', {}, [
      el('td', { class: 'num rank', text: '#' + r.rank }),
      el('td', {}, [
        el('span', { class: 'pname', text: r.name }),
        el('span', { class: 'pslug', text: r.slug }),
        el('span', { class: 'chains', text: r.chains.slice(0, 3).join(' \u00B7 ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
      ]),
      el('td', {}, [
        el('span', { class: 'pill', text: r.category || 'Uncategorised' }),
        ...(r.in_watchlist ? [' ', el('span', { class: 'pill watch', text: 'watchlist' })] : []),
      ]),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      change,
      el('td', { class: 'num implied', text: fmtUsd(r.implied_value_usd) }),
      el('td', { class: 'num' }, [el('span', { class: 'conf' }, [confBar, document.createTextNode(String(r.confidence))])]),
      el('td', {}, [el('span', { class: 'tier ' + r.tier, text: r.tier })]),
    ]);
    tr.addEventListener('click', () => {
      location.hash = '#/p/' + r.slug;
    });
    body.append(tr);
  }
  document.querySelectorAll('thead th').forEach((th) => {
    const key = th.getAttribute('data-sort');
    th.classList.toggle('sorted', key === state.sort && state.dir === 1);
    th.classList.toggle('sorted-asc', key === state.sort && state.dir === -1);
  });
}

/* ---------- detail ---------- */

function renderDetail(row) {
  const host = document.getElementById('detail-view');
  host.textContent = '';
  const recomputed = impliedOf(row);
  const agrees = recomputed === row.implied_value_usd;
  const facts = [
    ['TVL (snapshot)', fmtFull(row.tvl_usd)],
    ['TVL change, 7 days', fmtPct(row.change_7d)],
    ['Category', row.category || 'Uncategorised'],
    ['Chains', row.chains.join(', ')],
    ['Tracked since', row.listed_at || 'unreported'],
    ['Tokenless for', fmtAge(row.age_days)],
    ['Tier', row.tier + (row.in_watchlist ? ' \u00B7 on the house watchlist' : ' \u00B7 below the watchlist floor')],
    ['Confidence', row.confidence + ' / 100'],
  ];
  const formula =
    fmtFull(row.tvl_usd) + ' TVL  x  ' + row.ratio.toFixed(3) + ' peer ratio  x  ' +
    growthFactor(row.change_7d).toFixed(3) + ' momentum  x  ' + maturityFactor(row.age_days).toFixed(3) +
    ' track record  x  ' + breadthFactor(row.chains.length).toFixed(2) + ' breadth';
  const card = el('div', { class: 'detail-card' }, [
    el('div', { class: 'detail-head' }, [
      el('div', {}, [
        el('h2', { text: row.name }),
        el('p', {
          class: 'sub',
          text:
            'Rank #' + row.rank + ' of ' + ROWS.length + ' \u00B7 ' + row.slug + ' \u00B7 records no token in the snapshot ' +
            '(no CoinGecko id, no symbol, no market cap) and is not a wrapped, staked or bridged product of one that trades.',
        }),
      ]),
      el('div', { class: 'detail-value' }, [el('b', { text: fmtFull(row.implied_value_usd) }), el('span', { text: 'implied launch value' })]),
    ]),
    el('div', { class: 'fact-grid' }, facts.map(([k, v]) => el('div', { class: 'fact' }, [el('span', { text: k }), el('b', { text: v })]))),
    el('h3', { text: 'Where the number comes from' }),
    el('div', { class: 'formula' }, [formula + '   ', el('span', { class: 'eq', text: '= ' + fmtFull(row.implied_value_usd) })]),
    el('p', {
      class: 'check-line',
      text:
        'Peer ratio: the ' + row.ratio_basis + '. This page recomputes the value from the model and gets ',
    }),
    el('h3', { text: 'How to farm it' }),
    el('ol', { class: 'steps' }, row.farm_steps.map((s) => el('li', { text: s }))),
    el('p', {
      class: 'check-line',
      text: 'Farming is positioning, not a promise: a protocol may never issue a token, and capital placed in it carries the protocol\u2019s own risks.',
    }),
  ]);
  card.querySelector('.check-line').append(el('b', { text: fmtFull(recomputed) }), document.createTextNode(agrees ? ' \u2014 the same number board.json carries.' : ' \u2014 which differs from board.json: the data would be stale.'));
  const back = el('button', { class: 'back', text: '\u2190 Back to the board' });
  back.addEventListener('click', () => {
    location.hash = '#/';
  });
  host.append(back, card);
}

/* ---------- routing ---------- */

function route() {
  const hash = location.hash || '#/';
  const detailMatch = hash.match(/^#\/p\/(.+)$/);
  const boardView = document.getElementById('board-view');
  const detailView = document.getElementById('detail-view');
  if (detailMatch && bySlug.has(detailMatch[1])) {
    renderDetail(bySlug.get(detailMatch[1]));
    boardView.hidden = true;
    detailView.hidden = false;
    window.scrollTo(0, 0);
  } else {
    applyHashFilters();
    renderBoard();
    boardView.hidden = false;
    detailView.hidden = true;
  }
}

function applyHashFilters() {
  const hash = location.hash || '';
  const qAt = hash.indexOf('?');
  if (qAt < 0) return;
  const params = new URLSearchParams(hash.slice(qAt + 1));
  if (params.has('category')) state.category = params.get('category');
  if (params.has('chain')) state.chain = params.get('chain');
  if (params.has('tier')) state.tier = params.get('tier');
  if (params.has('q')) state.q = params.get('q');
  if (params.get('watch') === '1') state.watch = true;
  document.getElementById('f-category').value = state.category;
  document.getElementById('f-chain').value = state.chain;
  document.getElementById('f-tier').value = state.tier;
  document.getElementById('f-watch').checked = state.watch;
  document.getElementById('q').value = state.q;
}

/* ---------- wire up ---------- */

document.getElementById('q').addEventListener('input', (e) => {
  state.q = e.target.value;
  renderBoard();
});
document.getElementById('f-category').addEventListener('change', (e) => {
  state.category = e.target.value;
  renderBoard();
});
document.getElementById('f-chain').addEventListener('change', (e) => {
  state.chain = e.target.value;
  renderBoard();
});
document.getElementById('f-tier').addEventListener('change', (e) => {
  state.tier = e.target.value;
  renderBoard();
});
document.getElementById('f-watch').addEventListener('change', (e) => {
  state.watch = e.target.checked;
  renderBoard();
});
document.querySelectorAll('thead th').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.getAttribute('data-sort');
    if (state.sort === key) state.dir = state.dir === 1 ? -1 : 1;
    else {
      state.sort = key;
      state.dir = key === 'rank' || key === 'name' ? 1 : -1;
    }
    renderBoard();
  });
});
window.addEventListener('hashchange', route);

renderStats();
fillFilters();
applyHashFilters();
renderBoard();
route();
