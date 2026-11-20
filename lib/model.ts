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
// 2. Comparable ratio. Protocols whose token already trades reveal what the market
//    pays per dollar of TVL: mcap_usd / tvl_usd. The model takes the median of that
//    ratio over the candidate's own category (at least 3 peers), else over a family
//    of like categories, else over every tokenised protocol in the snapshot.
//
// 3. Implied value. implied = TVL x ratio x growth x maturity x breadth, where
//    growth rewards a rising 7-day TVL (clamped, so one wild week cannot dominate),
//    maturity rewards a long tokenless track record (listed_at to the snapshot's
//    as_of), and breadth gives a small premium per extra chain. The figure is an
//    implied launch market value: what a token issued on today's record would be
//    worth if the market priced this protocol like its launched peers. It is the
//    entry's own claim, not a prediction that a token will come.
//
// 4. Farm plan. Each candidate gets a concrete plan generated from its category
//    family, its main chain and its size band: the core position to open, the
//    weekly rhythm to keep, the governance and community work, and the snapshot
//    hygiene to hold, each step with a cost and a time budget.

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
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
}

export interface ModelParams {
  version: string;
  global_ratio: number;
  min_category_peers: number;
}

export const MODEL_VERSION = 'comparables-v1';

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
// category has too few launched peers of its own.
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

export interface RatioBook {
  globalRatio: number;
  byCategory: Map<string, { ratio: number; peers: number }>;
  byFamily: Map<string, { ratio: number; peers: number }>;
}

/** Medians of mcap/TVL over the snapshot's launched protocols. */
export function buildRatioBook(snapshot: Snapshot): RatioBook {
  const catValues = new Map<string, number[]>();
  const famValues = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (recordsNoToken(p)) continue; // peers are launched protocols: they record a token
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    if (p.category !== null) {
      const list = catValues.get(p.category) ?? [];
      list.push(ratio);
      catValues.set(p.category, list);
    }
    const fam = familyOf(p.category);
    const flist = famValues.get(fam) ?? [];
    flist.push(ratio);
    famValues.set(fam, flist);
  }
  const byCategory = new Map<string, { ratio: number; peers: number }>();
  for (const [cat, values] of catValues) byCategory.set(cat, { ratio: median(values), peers: values.length });
  const byFamily = new Map<string, { ratio: number; peers: number }>();
  for (const [fam, values] of famValues) byFamily.set(fam, { ratio: median(values), peers: values.length });
  return { globalRatio: median(all), byCategory, byFamily };
}

const MIN_PEERS = 3;

/** The comparable ratio for a candidate, and where it came from. */
export function ratioFor(book: RatioBook, category: string | null): { ratio: number; basis: string; peers: number } {
  if (category !== null) {
    const own = book.byCategory.get(category);
    if (own !== undefined && own.peers >= MIN_PEERS) {
      return { ratio: own.ratio, basis: `category median of ${own.peers} launched ${category} protocols`, peers: own.peers };
    }
  }
  const fam = familyOf(category);
  const famEntry = book.byFamily.get(fam);
  if (famEntry !== undefined && famEntry.peers >= MIN_PEERS && fam !== 'core') {
    return { ratio: famEntry.ratio, basis: `${fam} family median of ${famEntry.peers} launched protocols`, peers: famEntry.peers };
  }
  const core = book.byFamily.get('core');
  const peers = core !== undefined ? core.peers : 0;
  return { ratio: book.globalRatio, basis: `global median of all launched protocols in the snapshot`, peers };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Momentum: a rising week helps, a falling week hurts, both clamped hard. */
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

/** Track record: the longer a protocol has run tokenless, the fuller the factor. */
export function maturityFactor(age: number | null): number {
  if (age === null) return 0.95;
  const years = age / 365.25;
  return 0.85 + 0.075 * Math.min(years, 3);
}

/** A small premium for each extra chain the protocol already runs on. */
export function breadthFactor(chainCount: number): number {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 5);
}

/** The implied launch value of one candidate, in whole dollars. */
export function impliedValue(p: Protocol, ratio: number, asOf: string): { value: number; growth: number; maturity: number; breadth: number; age: number | null } {
  const growth = growthFactor(p.change_7d);
  const age = ageDays(p.listed_at, asOf);
  const maturity = maturityFactor(age);
  const breadth = breadthFactor(p.chains.length);
  const raw = p.tvl_usd * ratio * growth * maturity * breadth;
  return { value: Math.max(1, Math.round(raw)), growth, maturity, breadth, age };
}

/** Confidence 0-100: how much evidence stands behind this row's number. */
export function confidenceScore(peers: number, basis: string, age: number | null, tvl: number, change7d: number | null): number {
  let score = 40;
  if (basis.startsWith('category')) score += peers >= 8 ? 20 : 12;
  else if (basis.startsWith('global')) score += 2;
  else score += 8;
  if (age === null) score += 2;
  else if (age >= 730) score += 15;
  else if (age >= 365) score += 8;
  else if (age >= 90) score += 3;
  if (tvl >= 50_000_000) score += 10;
  else if (tvl >= 20_000_000) score += 6;
  else if (tvl >= 10_000_000) score += 3;
  if (change7d === null) score += 4;
  else if (change7d >= -10 && change7d <= 25) score += 8;
  else if (change7d >= -30 && change7d <= 60) score += 4;
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

/** Build the whole ranked board from the snapshot. */
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; params: ModelParams } {
  const book = buildRatioBook(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isCandidate(p)) continue;
    const r = ratioFor(book, p.category);
    const iv = impliedValue(p, r.ratio, snapshot.as_of);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: iv.value,
      farm_steps: farmPlan(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: iv.age,
      in_watchlist: watchlist.has(p.slug),
      tier: tierOf(p.tvl_usd),
      confidence: confidenceScore(r.peers, r.basis, iv.age, p.tvl_usd, p.change_7d),
      ratio: r.ratio,
      ratio_basis: r.basis,
      peer_count: r.peers,
      growth_factor: iv.growth,
      maturity_factor: iv.maturity,
      breadth_factor: iv.breadth,
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return { rows, params: { version: MODEL_VERSION, global_ratio: book.globalRatio, min_category_peers: MIN_PEERS } };
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
