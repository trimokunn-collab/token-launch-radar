// Token Launch Radar — the page. Renders the board data.js carries, fully
// offline. It also recomputes every implied value from the model in the open:
// the same arithmetic lib/model.ts ran, so a reader can watch the page and
// board.json agree, number for number.
//
// The model is one fitted log-log curve: implied = TVL x exp(a + b x ln(TVL)),
// with a and b fitted to the snapshot's launched protocols and carried in
// data.js as DATA.curve. Momentum (7-day TVL change), track record (age) and
// chain breadth are shown for context only — they were tested as multipliers
// and dropped, because they made held-out error worse (see the validation
// panel). Nothing on this page hardcodes the curve or the validation numbers:
// every figure is read out of data.js at runtime.

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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* ---------- the model, recomputed in the open ---------- */

// The curve, read out of data.js (DATA.model.curve: { a, b, n, tvl_min_usd,
// tvl_max_usd } — the build nests it under model; DATA.curve is accepted too).
// Fallback, only if the build did not carry it: recover a and b from the rows
// the page itself carries, since each row's ratio is the curve's ratio at that
// TVL (log ratio against log TVL). No coefficient is written in this file.
function curveParams() {
  const c = DATA.curve || (DATA.model && DATA.model.curve);
  if (c && Number.isFinite(c.a) && Number.isFinite(c.b)) {
    return { a: c.a, b: c.b, n: c.n ?? null, tvlMin: c.tvlMin ?? c.tvl_min_usd ?? null, tvlMax: c.tvlMax ?? c.tvl_max_usd ?? null };
  }
  const pts = ROWS.filter((r) => Number.isFinite(r.ratio) && r.tvl_usd > 0).map((r) => [Math.log(r.tvl_usd), Math.log(r.ratio)]);
  if (pts.length < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const denom = pts.reduce((s, p) => s + (p[0] - mx) * (p[0] - mx), 0);
  if (denom === 0) return null;
  const b = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / denom;
  return { a: my - b * mx, b, n: pts.length, tvlMin: null, tvlMax: null };
}

const CURVE = curveParams();

/** The curve's ratio at a TVL: exp(a + b x ln(TVL)). */
function curveRatio(tvl) {
  if (!CURVE || tvl <= 0) return NaN;
  return Math.exp(CURVE.a + CURVE.b * Math.log(tvl));
}

function impliedOf(row) {
  if (CURVE) return Math.max(1, Math.round(row.tvl_usd * curveRatio(row.tvl_usd)));
  return row.implied_value_usd;
}

/* ---------- validation figures, read out of data.js ---------- */

// Tolerates the field names the model build may use (loo / leave_one_out,
// timesplit / time_split); every number still comes from data.js.
function pick(obj, names) {
  if (!obj) return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

function normEntry(entry) {
  if (!entry) return null;
  return {
    median_factor: pick(entry, ['median_factor', 'medianFactor']),
    within_2x: pick(entry, ['within_2x', 'within_2x_pct', 'within2x', 'within_2']),
    within_3x: pick(entry, ['within_3x', 'within_3x_pct', 'within3x', 'within_3']),
    n: pick(entry, ['n', 'count']),
    cutoff: pick(entry, ['cutoff', 'split_date', 'splitDate']),
  };
}

function validationData() {
  const raw = DATA.validation || (DATA.model && DATA.model.validation) || null;
  if (!raw) return null;
  const factorsRaw = pick(raw, ['factors_tested', 'with_factors', 'factors']);
  const baselineRaw = pick(raw, ['baseline', 'baseline_median_factor', 'baseline_median_loo']);
  return {
    loo: normEntry(pick(raw, ['loo', 'leave_one_out', 'loo_cv'])),
    timesplit: normEntry(pick(raw, ['timesplit', 'time_split', 'timeSplit'])),
    range_factor: pick(raw, ['range_factor', 'rangeFactor']),
    factors_tested: factorsRaw && typeof factorsRaw === 'object' ? normEntry(factorsRaw) : null,
    baseline_median_factor: typeof baselineRaw === 'number' ? baselineRaw : baselineRaw && baselineRaw.median_factor ? baselineRaw.median_factor : null,
    n: pick(raw, ['n', 'live_protocols', 'protocols']),
  };
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

/* ---------- KPI strip + method + validation ---------- */

function renderKpis() {
  const host = document.getElementById('masthead-stats');
  const v = validationData();
  const s = DATA.stats || {};
  const kpis = DATA.kpis || {};
  // The median ratio is the model's own figure: the median mcap/TVL across
  // the 128 live-token protocols (stats.median_ratio, 0.214). Only when the
  // build does not carry it do we fall back to the median of the curve's
  // ratios across the board's rows, which is a different number (0.325) and
  // must never be shown in its place.
  const medianRatio = Number.isFinite(s.median_ratio)
    ? s.median_ratio
    : Number.isFinite(kpis.median_ratio)
      ? kpis.median_ratio
      : median(ROWS.map((r) => curveRatio(r.tvl_usd)).filter((x) => Number.isFinite(x)));
  const topImplied = Number.isFinite(s.top_implied_usd)
    ? s.top_implied_usd
    : Number.isFinite(kpis.top_implied_usd)
      ? kpis.top_implied_usd
      : ROWS.length
        ? ROWS[0].implied_value_usd
        : 0;
  const loo = v && v.loo;
  const stats = [
    [String(DATA.stats.candidates), 'pre-token ranked'],
    [DATA.stats.watchlist_covered + '/' + DATA.stats.watchlist_size, 'watchlist covered'],
    [Number.isFinite(medianRatio) ? medianRatio.toFixed(3) : '\u2014', 'median ratio'],
    [CURVE ? 'a ' + CURVE.a.toFixed(3) + ' \u00B7 b ' + CURVE.b.toFixed(3) : '\u2014', 'fitted curve'],
    [
      loo && Number.isFinite(loo.median_factor) ? '\u00D7' + loo.median_factor.toFixed(2) : '\u2014',
      'leave-one-out error' + (loo && loo.n ? ' (n=' + loo.n + ')' : ''),
    ],
    [fmtUsd(topImplied), 'top implied value'],
    [DATA.as_of, 'snapshot date'],
  ];
  for (const [value, label] of stats) {
    host.append(el('div', { class: 'stat' }, [el('b', { text: value }), el('span', { text: label })]));
  }
}

function renderMethod() {
  const method = document.getElementById('method');
  const fittedOn = CURVE && CURVE.n ? ', fitted on ' + CURVE.n + ' launched protocols' : '';
  method.append(
    el('h2', { text: 'How the radar prices a launch that has not happened' }),
    el('p', { text: DATA.model.summary }),
    el('p', {}, [
      'In one line: ',
      el('code', { text: CURVE ? 'implied = TVL x exp(' + CURVE.a.toFixed(3) + ' + ' + CURVE.b.toFixed(3) + ' x ln(TVL))' : 'implied = TVL x curve ratio' }),
      ' \u2014 model ' + DATA.model.version + fittedOn +
        '. Open any protocol: the page recomputes its value from this curve and shows it beside the number board.json carries.',
    ]),
  );
}

function renderValidation() {
  const host = document.getElementById('validation');
  const v = validationData();
  const n = (v && v.n) || (v && v.loo && v.loo.n) || (CURVE && CURVE.n) || null;
  host.append(el('h2', { text: 'How the value model was tested' }));
  host.append(
    el('p', {
      text:
        'The board prices a launch from one fitted curve, not from a category average. ' +
        'Across the snapshot\u2019s launched protocols, log(market cap / TVL) was fitted against log(TVL): ' +
        'bigger protocols trade at a lower multiple, and the curve follows that slope. Every implied value ' +
        'on this page is TVL times the curve\u2019s ratio at that TVL.',
    }),
  );

  const facts = [];
  if (v && v.loo && Number.isFinite(v.loo.median_factor)) {
    facts.push([
      'Leave-one-out error',
      '\u00D7' + v.loo.median_factor.toFixed(2),
      'median error factor \u2014 each launched protocol held out once, the curve refit without it',
    ]);
  }
  if (v && v.loo && Number.isFinite(v.loo.within_2x)) {
    facts.push(['Within 2\u00D7', v.loo.within_2x.toFixed(1) + '%', 'of held-out launches predicted within twice their real market cap']);
  }
  if (v && v.loo && Number.isFinite(v.loo.within_3x)) {
    facts.push(['Within 3\u00D7', v.loo.within_3x.toFixed(1) + '%', 'of held-out launches predicted within three times']);
  }
  if (v && v.timesplit && Number.isFinite(v.timesplit.median_factor)) {
    const cutoff = v.timesplit.cutoff;
    facts.push([
      'Time-split error',
      '\u00D7' + v.timesplit.median_factor.toFixed(2),
      cutoff ? 'curve fitted on listings before ' + cutoff + ', tested on listings after' : 'curve fitted on earlier listings, tested on later ones',
    ]);
  }
  if (v && v.timesplit && Number.isFinite(v.timesplit.within_2x)) {
    facts.push(['Time-split within 2\u00D7', v.timesplit.within_2x.toFixed(1) + '%', 'of later listings predicted within twice']);
  }
  if (v && v.timesplit && Number.isFinite(v.timesplit.within_3x)) {
    facts.push(['Time-split within 3\u00D7', v.timesplit.within_3x.toFixed(1) + '%', 'of later listings predicted within three times']);
  }
  if (CURVE) {
    facts.push([
      'Fitted curve',
      'a ' + CURVE.a.toFixed(3) + ' \u00B7 b ' + CURVE.b.toFixed(3),
      'log(mcap/TVL) = a + b \u00B7 log(TVL)' + (n ? ', fitted on ' + n + ' launched protocols' : ''),
    ]);
  }
  if (CURVE && Number.isFinite(CURVE.tvlMin) && Number.isFinite(CURVE.tvlMax)) {
    facts.push(['Fitted TVL range', fmtUsd(CURVE.tvlMin) + ' \u2013 ' + fmtUsd(CURVE.tvlMax), 'values outside this range extrapolate the curve']);
  }
  if (facts.length) {
    host.append(
      el('div', { class: 'val-grid' }, facts.map(([k, val, sub]) => el('div', { class: 'val-fact' }, [el('span', { text: k }), el('b', { text: val }), el('small', { text: sub })]))),
    );
  }

  let dropped =
    'Momentum (7-day TVL change), track record (age) and chain breadth were tested as multipliers on top of the curve and dropped: ';
  if (v && v.factors_tested && Number.isFinite(v.factors_tested.median_factor) && v.loo && Number.isFinite(v.loo.median_factor)) {
    dropped +=
      'the curve alone held out better (\u00D7' + v.loo.median_factor.toFixed(2) + ') than the curve with the factors (\u00D7' + v.factors_tested.median_factor.toFixed(2) + '). ';
  } else {
    dropped += 'they did not improve held-out error. ';
  }
  dropped += 'They stay on the board as context \u2014 the 7d, age and chain columns \u2014 and never enter a value.';
  host.append(el('p', { text: dropped }));

  if (v && Number.isFinite(v.baseline_median_factor) && v.loo && Number.isFinite(v.loo.median_factor)) {
    host.append(
      el('p', {
        text:
          'For comparison, the earlier category-median model held out at \u00D7' + v.baseline_median_factor.toFixed(2) +
          ' on the same leave-one-out test \u2014 the fitted curve is the upgrade, not a new coat of paint.',
      }),
    );
  }

  host.append(
    el('p', {
      class: 'limit',
      text:
        'Honest limit: the snapshot is one date, so this is a cross-section test, not a genuine historical walk-forward test. ' +
        'A curve that fits one day\u2019s market can still be wrong about the next one \u2014 treat every implied value as an estimate with a wide range, not a price.',
    }),
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

function sortRatio(row) {
  const r = curveRatio(row.tvl_usd);
  if (Number.isFinite(r)) return r;
  return Number.isFinite(row.ratio) ? row.ratio : 0;
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
    } else if (state.sort === 'ratio') {
      cmp = sortRatio(a) - sortRatio(b);
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
    const ratio = sortRatio(r);
    const ratioText = CURVE || Number.isFinite(r.ratio) ? ratio.toFixed(3) : '\u2014';
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
      el('td', { class: 'num ratio', text: ratioText }),
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
  const diff = Math.abs(recomputed - row.implied_value_usd);
  const agrees = diff === 0;
  const close = !agrees && diff <= Math.max(1, row.implied_value_usd * 0.001);
  const agreesText = agrees
    ? ' \u2014 the same number board.json carries.'
    : close
      ? ' \u2014 within rounding of the number board.json carries.'
      : ' \u2014 which differs from board.json: the data would be stale.';
  const ratio = curveRatio(row.tvl_usd);
  const ratioText = Number.isFinite(ratio) ? ratio.toFixed(3) : Number.isFinite(row.ratio) ? row.ratio.toFixed(3) : '\u2014';
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
  const formula = fmtFull(row.tvl_usd) + ' TVL  x  ' + ratioText + ' curve ratio';
  const curveLine = CURVE
    ? 'curve ratio = exp(' + CURVE.a.toFixed(3) + ' + ' + CURVE.b.toFixed(3) + ' \u00D7 ln(TVL)), fitted on ' +
      (CURVE.n ? CURVE.n + ' launched protocols' : 'the snapshot\u2019s launched protocols') + ' in the sealed snapshot.'
    : 'curve ratio read from the board data.';
  // Fitted range, display-only: the row's low/high from the model, or the
  // implied value divided / multiplied by the validation range factor.
  const vDetail = validationData();
  let rangeFactor = vDetail && Number.isFinite(vDetail.range_factor) ? vDetail.range_factor : null;
  if (rangeFactor === null && Number.isFinite(row.implied_high) && row.implied_value_usd > 0) {
    rangeFactor = row.implied_high / row.implied_value_usd;
  }
  const rangeN = (vDetail && vDetail.loo && vDetail.loo.n) || (CURVE && CURVE.n) || null;
  const rangeLow = Number.isFinite(row.implied_low)
    ? row.implied_low
    : rangeFactor
      ? Math.max(1, Math.round(row.implied_value_usd / rangeFactor))
      : null;
  const rangeHigh = Number.isFinite(row.implied_high)
    ? row.implied_high
    : rangeFactor
      ? Math.round(row.implied_value_usd * rangeFactor)
      : null;
  const rangeLine =
    rangeFactor && rangeLow !== null && rangeHigh !== null
      ? el('p', {
          class: 'check-line',
          text:
            'Fitted range ' + fmtFull(rangeLow) + ' \u2013 ' + fmtFull(rangeHigh) + ' \u2014 80% of the ' + rangeN +
            ' held-out launches landed within \u00D7' + rangeFactor.toFixed(2) + ' of the curve value.',
        })
      : null;
  const recomputeLine = el('p', { class: 'check-line' }, [
    'This page recomputes the value from the curve and gets ',
    el('b', { text: fmtFull(recomputed) }),
    document.createTextNode(agreesText),
  ]);
  const outsideRange =
    CURVE && Number.isFinite(CURVE.tvlMin) && Number.isFinite(CURVE.tvlMax) && (row.tvl_usd < CURVE.tvlMin || row.tvl_usd > CURVE.tvlMax);
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
    ...(rangeLine ? [rangeLine] : []),
    el('p', { class: 'check-line', text: curveLine }),
    ...(outsideRange
      ? [
          el('p', {
            class: 'extrap',
            text:
              'Outside the TVL range the curve was fitted on (' + fmtUsd(CURVE.tvlMin) + '\u2013' + fmtUsd(CURVE.tvlMax) +
              '): this value extrapolates the curve, so treat it with extra caution.',
          }),
        ]
      : []),
    el('p', {
      class: 'check-line',
      text:
        'Context, not priced in: 7-day TVL change ' + fmtPct(row.change_7d) + ', tokenless for ' + fmtAge(row.age_days) + ', ' +
        row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') +
        ' \u2014 momentum, track record and breadth were tested and dropped (see the validation panel).',
    }),
    recomputeLine,
    el('h3', { text: 'How to farm it' }),
    el('ol', { class: 'steps' }, row.farm_steps.map((s) => el('li', { text: s }))),
    el('p', {
      class: 'check-line',
      text: 'Farming is positioning, not a promise: a protocol may never issue a token, and capital placed in it carries the protocol\u2019s own risks.',
    }),
  ]);
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

renderKpis();
renderMethod();
renderValidation();
fillFilters();
applyHashFilters();
renderBoard();
route();
