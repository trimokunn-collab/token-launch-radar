// Token Launch Radar — the value model.
//
// Everything in this file is derived from the sealed snapshot alone: no network, no
// outside data, no hardcoded protocol names. The model has four steps.
//
// 1. Universe. A protocol is a launch candidate when DefiLlama's record carries no
//    token for it (gecko_id, symbol and mcap_usd all null) and it is not a wrapped,
//    staked or bridged product of a protocol whose token already trades. The product
//    test mirrors the house watchlist rule (excluded categories, "wrapped / staked /
//    staking" name words, version-suffixed names, exchange-prefixed names) so the
//    board and the watchlist speak the same language; the board then goes past the
//    watchlist's $50M floor down to the snapshot's $5M edge.
//
// 2. The curve. Protocols whose token already trades reveal what the market pays
//    per dollar of TVL: mcap_usd / tvl_usd. The model fits that multiple against
//    size by least squares in log space — log(mcap/TVL) = a + b*log(TVL) — over
//    the snapshot's live-token protocols. The slope is negative: the multiple
//    falls as TVL grows, which is what the live market actually does. A
//    candidate's ratio is the curve at its own TVL, and implied = TVL x ratio.
//    The curve replaces the earlier category-median ratios: held out, the median
//    model errs by 5.17x while the curve errs by 3.40x (see validateModel).
//
// 3. Validation, computed live. validateModel refits the curve with each live
//    protocol held out once (leave-one-out) and again on the earlier-listed half
//    tested on the later-listed half (a listing-date split), and reports the
//    median error factor and the share inside 2x and 3x for each, beside the
//    category-median baseline on the same test. It also reports the
//    80th-percentile leave-one-out error factor as range_factor, which each
//    row carries as a display-only fitted range (implied / factor to implied
//    x factor). Honest limits: this is one
//    snapshot date, so neither test is a walk-forward test through time — a
//    single date cannot show that — and the error is a within-snapshot figure,
//    not a promise about future launches.
//
// 4. Farm plan. Each candidate gets a concrete plan generated from its category
//    family, its main chain and its size band: the core position to open, the
//    weekly rhythm to keep, the governance and community work, and the snapshot
//    hygiene to hold, each step with a cost and a time budget.
//
// The 7-day momentum, track record and chain breadth are shown on every row as
// context, and are NOT multiplied into the value: held out, multiplying them in
// made the curve's error worse (3.40x alone, 3.56x with them), so the value is
// the curve alone and the factors stay visible as facts about the protocol.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  // Fitted range, display-only: implied value divided / multiplied by the
  // 80th-percentile leave-one-out error factor. Never changes the ranking.
  implied_low: number;
  implied_high: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  in_watchlist: boolean;
  tier: string;
  confidence: number;
  ratio: number;
  ratio_basis: string;
  peer_count: number;
  extrapolated: boolean;
  // Context only: shown beside the row, never multiplied into implied value.
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
}

/** The fitted log-log curve: log(mcap/TVL) = a + b*log(TVL). */
export interface CurveFit {
  a: number;
  b: number;
  n: number;
  tvl_min_usd: number;
  tvl_max_usd: number;
}

/** One held-out test: median error factor and the shares inside 2x and 3x. */
export interface ValidationSplit {
  n: number;
  median_factor: number;
  within_2x_pct: number;
  within_3x_pct: number;
}

/** The listing-date split: fitted on the earlier-listed half, tested on the later. */
export interface TimeSplitValidation extends ValidationSplit {
  train_n: number;
  cutoff: string;
}

/** The model's held-out validation, computed live from the snapshot. */
export interface Validation {
  loo: ValidationSplit;
  time_split: TimeSplitValidation;
  baseline_median_loo: ValidationSplit;
  /** 80th-percentile leave-one-out error factor: exp of the 80th-percentile
   *  absolute log error across the held-out protocols. Each row's fitted
   *  range is implied / range_factor to implied * range_factor. */
  range_factor: number;
  note: string;
}

/** The board's headline numbers, computed live from the rows. */
export interface BoardKpis {
  candidates: number;
  watchlist_covered: number;
  watchlist_size: number;
  median_ratio: number;
  top_implied_usd: number;
  total_implied_usd: number;
  median_implied_usd: number;
}

export interface ModelParams {
  version: string;
}

export const MODEL_VERSION = 'curve-v1';

// Categories that are products of another protocol's token, never a launch of
// their own (the house watchlist rule, reused for the whole board).
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const PRODUCT_NAME_WORDS = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Category families: categories close enough to share a comparable ratio when a
// category has too few launched peers of its own. Used by the farm plan's voice
// and by the validation baseline, never by the curve itself.
const FAMILIES: Record<string, string> = {
  'Lending': 'credit',
  'CDP': 'credit',
  'Dexs': 'trading',
  'Derivatives': 'trading',
  'Yield': 'yield',
  'Yield Aggregator': 'yield',
  'Risk Curators': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Liquidity Manager': 'yield',
  'Basis Trading': 'yield',
  'Leveraged Farming': 'yield',
  'Staking Pool': 'yield',
  'Restaking': 'yield',
  'Farm': 'yield',
  'RWA': 'assets',
  'Indexes': 'assets',
  'Tokenized Stock': 'assets',
  'Chain': 'chain',
};

export function familyOf(category: string | null): string {
  if (category === null) return 'core';
  return FAMILIES[category] ?? 'core';
}

/** True when DefiLlama's record carries no token for the protocol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** True when the protocol is a wrapped, staked or bridged product of another. */
export function isProductOfAnother(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_NAME_WORDS.test(p.name)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  const firstWord = p.name.split(' ')[0] ?? '';
  return EXCHANGE_PREFIXES.includes(firstWord);
}

/** A launch candidate: records no token and is not a product of one that trades. */
export function isCandidate(p: Protocol): boolean {
  return recordsNoToken(p) && !isProductOfAnother(p);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank percentile (p in 0..1): the value at rank ceil(p * n). */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The live-token protocols: a market cap and a TVL, both positive. */
export function liveProtocols(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Fit log(mcap/TVL) = a + b*log(TVL) by ordinary least squares over the
 * live-token protocols. The slope is expected negative: the market pays a
 * smaller multiple per TVL dollar as a protocol gets bigger.
 */
export function fitCurve(live: Protocol[]): CurveFit {
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const n = live.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  const tvls = live.map((p) => p.tvl_usd);
  return { a, b, n, tvl_min_usd: Math.min(...tvls), tvl_max_usd: Math.max(...tvls) };
}

/** The curve's multiple at one TVL: exp(a + b*ln(TVL)). */
export function curveRatio(curve: CurveFit, tvl: number): number {
  return Math.exp(curve.a + curve.b * Math.log(tvl));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Momentum, shown as context: a rising week helps, a falling week hurts, both clamped hard. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const pct = clamp(change7d, -60, 150);
  return clamp(1 + (pct / 100) * 0.3, 0.8, 1.45);
}

/** Whole days from listed_at to the snapshot's as_of; null when unreported. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Track record, shown as context: the longer a protocol has run tokenless, the fuller the factor. */
export function maturityFactor(age: number | null): number {
  if (age === null) return 0.95;
  const years = age / 365.25;
  return 0.85 + 0.075 * Math.min(years, 3);
}

/** Chain breadth, shown as context: a small premium for each extra chain the protocol already runs on. */
export function breadthFactor(chainCount: number): number {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 5);
}

/**
 * The implied launch value of one candidate, in whole dollars: TVL x the curve
 * ratio, and nothing else. The growth, maturity and breadth factors are computed
 * and returned as context, but they are NOT multiplied in — held out, doing so
 * made the curve's error worse (3.40x alone, 3.56x with them).
 */
export function impliedValue(p: Protocol, ratio: number, asOf: string): { value: number; growth: number; maturity: number; breadth: number; age: number | null } {
  const growth = growthFactor(p.change_7d);
  const age = ageDays(p.listed_at, asOf);
  const maturity = maturityFactor(age);
  const breadth = breadthFactor(p.chains.length);
  const raw = p.tvl_usd * ratio;
  return { value: Math.max(1, Math.round(raw)), growth, maturity, breadth, age };
}

/**
 * Confidence 0-100: how much evidence stands behind this row's number. A curve
 * fitted on the snapshot's live-token protocols is real evidence; a TVL inside
 * the fitted range is worth more than an extrapolation past it; a long tokenless
 * track record, a large TVL and a calm 7-day move each add a little.
 */
export function confidenceScore(curve: CurveFit, extrapolated: boolean, age: number | null, tvl: number, change7d: number | null): number {
  // The base is the fit itself: a curve fitted on curve.n live-token protocols
  // is real evidence, and the more protocols it was fitted on, the more.
  let score = 45 + Math.min(12, Math.floor(curve.n / 12));
  if (!extrapolated) score += 10;
  if (age === null) score += 1;
  else if (age >= 730) score += 12;
  else if (age >= 365) score += 7;
  else if (age >= 90) score += 3;
  if (tvl >= 50_000_000) score += 8;
  else if (tvl >= 20_000_000) score += 5;
  else if (tvl >= 10_000_000) score += 2;
  if (change7d === null) score += 3;
  else if (change7d >= -10 && change7d <= 25) score += 6;
  else if (change7d >= -30 && change7d <= 60) score += 3;
  else score += 1;
  return Math.min(97, score);
}

/** Size tier from TVL: S is the house watchlist's band, then A, B, C below it. */
export function tierOf(tvl: number): string {
  if (tvl >= 50_000_000) return 'S';
  if (tvl >= 20_000_000) return 'A';
  if (tvl >= 10_000_000) return 'B';
  return 'C';
}

function money(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(usd >= 100_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${usd}`;
}

/** The deposit band a farmer would sensibly work with at this protocol's size. */
function sizeBand(tvl: number): { low: number; high: number } {
  if (tvl >= 50_000_000) return { low: 1000, high: 5000 };
  if (tvl >= 20_000_000) return { low: 500, high: 2500 };
  if (tvl >= 10_000_000) return { low: 250, high: 1000 };
  return { low: 100, high: 500 };
}

/** Gas reality of a chain: Ethereum mainnet is dear, most other chains are cents. */
function gasNote(chain: string): string {
  if (chain === 'Ethereum') return 'Ethereum mainnet gas of roughly $5-$30 per transaction at quiet times';
  if (chain === 'Bitcoin') return 'Bitcoin network fees of roughly $1-$5 per transaction';
  return `gas on ${chain} of a few cents to about $2 per transaction`;
}

interface FarmVoice {
  open: string;
  grow: string;
  asset: string;
}

const FARM_VOICES: Record<string, FarmVoice> = {
  credit: {
    open: 'Supply the asset with the deepest market on the main chain and take a small borrow against it, so the account shows both sides of the book',
    grow: 'Roll the borrow back in as supply once (a gentle loop), then hold the position; add to it on the weekly visit instead of opening new ones',
    asset: 'a blue-chip the market lists (ETH, a major stablecoin or the chain\u2019s gas token)',
  },
  trading: {
    open: 'Make real trades through the main market and open a first liquidity position in the busiest pair, so volume and LP share both attach to the account',
    grow: 'Keep the LP position in range and re-balance it weekly; route ordinary swaps you would make anyway through the protocol instead of an aggregator',
    asset: 'the pair the protocol is known for (a major stablecoin against the chain\u2019s main asset)',
  },
  yield: {
    open: 'Deposit into the flagship vault or strategy and keep the receipt position untouched, so the full balance counts at any snapshot',
    grow: 'Split a second deposit across one more strategy on a different chain the protocol runs, and compound the yield back in monthly',
    asset: 'a major stablecoin or the chain\u2019s main asset, whichever the flagship vault takes',
  },
  assets: {
    open: 'Buy or mint a first position in the protocol\u2019s core asset through its own market and hold it in the account, unlevered',
    grow: 'Add to the position on a fixed weekly schedule rather than in one lump, and use any yield or redemption feature the protocol offers at least once',
    asset: 'the protocol\u2019s core asset itself, bought in the size band above',
  },
  chain: {
    open: 'Bridge a working balance to the chain and use two or three of its native applications, so the account holds real on-chain history there',
    grow: 'Keep a balance on the chain and transact there weekly (a transfer, a swap, a stake), rather than bridging in and straight back out',
    asset: 'the chain\u2019s gas token, bridged in once and topped up as it is spent',
  },
  core: {
    open: 'Use the protocol\u2019s main product end to end once (deposit, act, withdraw a part) so the account is a real user, then leave a working position open',
    grow: 'Repeat the core action weekly in modest size and try each major feature at least once, so the account\u2019s history covers the product, not one button',
    asset: 'a major stablecoin or the chain\u2019s main asset',
  },
};

/** Five concrete steps per protocol: action, cost and time on every step. */
export function farmPlan(p: Protocol): string[] {
  const voice = FARM_VOICES[familyOf(p.category)] ?? FARM_VOICES['core']!;
  const open = voice.open.charAt(0).toLowerCase() + voice.open.slice(1);
  const band = sizeBand(p.tvl_usd);
  const mainChain = p.chains[0] ?? 'Ethereum';
  const chainList = p.chains.slice(0, 3).join(', ');
  const gas = gasNote(mainChain);
  const weeks = p.tvl_usd >= 20_000_000 ? '10-12' : '8-10';
  return [
    `Set up on ${mainChain}: fund a fresh wallet with ${money(band.low)}-${money(band.high)} of ${voice.asset} and ${open} at ${p.name}. Cost: ${gas}, plus the capital itself. Time: about 30 minutes once.`,
    `Grow the position in week one: ${voice.grow}. Keep every position in the same wallet. Cost: one or two more transactions (${gas}). Time: 15-20 minutes.`,
    `Hold the weekly rhythm for ${weeks} weeks: revisit ${p.name} once a week, repeat the core action in small size and never let the account sit empty at a month end, when snapshots are usually taken. Cost: ${gas} per visit. Time: 10 minutes a week.`,
    `Do the community work: join ${p.name}\u2019s Discord and forum, vote or delegate in governance if it is live, and finish any official quest the team runs (Galxe, Layer3 or its own points page) the week it appears. Cost: free. Time: 1-2 hours spread over the season.`,
    `Stay snapshot-ready across ${chainList}: keep the position open until the team announces a snapshot or a launch, claim within the first days of any claim window, and only then decide to hold or sell. Cost: ${gas} per claim. Time: 5 minutes a week of checking.`,
  ];
}

// ---------------------------------------------------------------- validation

function errorFactor(predicted: number, actual: number): number {
  return Math.max(predicted / actual, actual / predicted);
}

function summarise(factors: number[]): ValidationSplit {
  const n = factors.length;
  if (n === 0) return { n: 0, median_factor: 0, within_2x_pct: 0, within_3x_pct: 0 };
  return {
    n,
    median_factor: round2(median(factors)),
    within_2x_pct: round1((factors.filter((f) => f <= 2).length / n) * 100),
    within_3x_pct: round1((factors.filter((f) => f <= 3).length / n) * 100),
  };
}

/** The category-median ratio for one protocol, itself excluded: the baseline the curve must beat. */
function medianRatioExcluding(live: Protocol[], self: Protocol): number {
  const catPeers = live
    .filter((q) => q.slug !== self.slug && q.category !== null && q.category === self.category)
    .map((q) => q.mcap_usd! / q.tvl_usd);
  if (catPeers.length >= 3) return median(catPeers);
  const fam = familyOf(self.category);
  if (fam !== 'core') {
    const famPeers = live
      .filter((q) => q.slug !== self.slug && familyOf(q.category) === fam)
      .map((q) => q.mcap_usd! / q.tvl_usd);
    if (famPeers.length >= 3) return median(famPeers);
  }
  return median(live.filter((q) => q.slug !== self.slug).map((q) => q.mcap_usd! / q.tvl_usd));
}

/**
 * The model's held-out validation, computed live from the snapshot:
 * leave-one-out (refit the curve with each live protocol held out once),
 * a listing-date split (fit on the earlier-listed half, test on the later),
 * and the category-median baseline on the same leave-one-out test.
 */
export function validateModel(live: Protocol[]): Validation {
  const looFactors: number[] = [];
  for (const held of live) {
    const train = live.filter((q) => q.slug !== held.slug);
    const curve = fitCurve(train);
    looFactors.push(errorFactor(held.tvl_usd * curveRatio(curve, held.tvl_usd), held.mcap_usd!));
  }

  const dated = live
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  let timeSplit: TimeSplitValidation = { n: 0, train_n: 0, cutoff: '', median_factor: 0, within_2x_pct: 0, within_3x_pct: 0 };
  if (dated.length >= 4) {
    const cutoff = dated[Math.floor(dated.length / 2)]!.listed_at!;
    const train = dated.filter((p) => p.listed_at! < cutoff);
    const test = dated.filter((p) => p.listed_at! >= cutoff);
    if (train.length > 0 && test.length > 0) {
      const curve = fitCurve(train);
      const factors = test.map((p) => errorFactor(p.tvl_usd * curveRatio(curve, p.tvl_usd), p.mcap_usd!));
      timeSplit = { ...summarise(factors), train_n: train.length, cutoff };
    }
  }

  const baselineFactors = live.map((p) => errorFactor(p.tvl_usd * medianRatioExcluding(live, p), p.mcap_usd!));

  // The fitted range factor: the 80th-percentile leave-one-out error factor.
  // Each loo factor is exp(|log error|) for one held-out protocol, so the
  // 80th percentile of the factors is exp of the 80th-percentile absolute
  // log error — the factor 80% of held-out launches stayed inside.
  const rangeFactor = round2(percentile(looFactors, 0.8));

  return {
    loo: summarise(looFactors),
    time_split: timeSplit,
    baseline_median_loo: summarise(baselineFactors),
    range_factor: rangeFactor,
    note:
      'Held out on one snapshot date: leave-one-out refits the curve once per live protocol, and the ' +
      'time split fits on the earlier-listed half and tests on the later half. Neither is a walk-forward ' +
      'test through time — a single snapshot cannot show that — so the error is a within-snapshot figure, ' +
      'not a promise about future launches.',
  };
}

/** Build the whole ranked board from the snapshot. */
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; params: ModelParams; curve: CurveFit; validation: Validation; kpis: BoardKpis } {
  const live = liveProtocols(snapshot.protocols);
  const curve = fitCurve(live);
  const validation = validateModel(live);
  const rangeFactor = validation.range_factor > 0 ? validation.range_factor : 1;
  const watchlist = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isCandidate(p)) continue;
    const ratio = curveRatio(curve, p.tvl_usd);
    const iv = impliedValue(p, ratio, snapshot.as_of);
    const extrapolated = p.tvl_usd < curve.tvl_min_usd || p.tvl_usd > curve.tvl_max_usd;
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: iv.value,
      implied_low: Math.max(1, Math.round(iv.value / rangeFactor)),
      implied_high: Math.round(iv.value * rangeFactor),
      farm_steps: farmPlan(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: iv.age,
      in_watchlist: watchlist.has(p.slug),
      tier: tierOf(p.tvl_usd),
      confidence: confidenceScore(curve, extrapolated, iv.age, p.tvl_usd, p.change_7d),
      ratio,
      ratio_basis: `log-log curve fit on ${curve.n} live-token protocols`,
      peer_count: curve.n,
      extrapolated,
      growth_factor: iv.growth,
      maturity_factor: iv.maturity,
      breadth_factor: iv.breadth,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  const kpis: BoardKpis = {
    candidates: rows.length,
    watchlist_covered: rows.filter((r) => r.in_watchlist).length,
    watchlist_size: snapshot.watchlist.length,
    median_ratio: median(live.map((p) => p.mcap_usd! / p.tvl_usd)),
    top_implied_usd: rows[0]?.implied_value_usd ?? 0,
    total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_implied_usd: rows.length > 0 ? median(rows.map((r) => r.implied_value_usd)) : 0,
  };
  return { rows, params: { version: MODEL_VERSION }, curve, validation, kpis };
}

/** The first gate problem with a board, or null when it is shaped right. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100) return `only ${rows.length} rows, the gate wants at least 100`;
  if (rows.length > 4000) return `${rows.length} rows, the gate allows at most 4000`;
  const seen = new Set<string>();
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, ranks must run 1 to N`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i + 1}: implied value is not a positive whole number`;
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    if (row.implied_value_usd !== rows[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: farm plan has ${row.farm_steps.length} steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters once trimmed`;
    }
  }
  if (allSame) return 'every implied value is the same: that is not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** Parse and shape-check the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (typeof data.as_of !== 'string' || !Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot is missing as_of, protocols or watchlist');
  }
  return data;
}
