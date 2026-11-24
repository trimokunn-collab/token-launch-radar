// Token Launch Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks every pre-token protocol by the
// implied launch value of the log-log curve model in lib/model.ts, and writes
// the hand-in to the output directory:
//   board.json    the ranked board plus the fitted curve, its held-out
//                 validation and the headline KPIs (the gate reads the rows)
//   data.js       the same board, as a script the dashboard loads offline
//   dashboard/    a copy of this repository's static dashboard
//   screenshots/  a copy of this repository's three screenshots
//   dossier.json  buildDossier() from vendor/makefun-board.ts, written last
//
// In the grader the snapshot is at /input/snapshot.json and the output at
// /output. Locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
// The program is deterministic: same snapshot in, same bytes out.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, parseSnapshot } from './lib/model.ts';
import type { BoardKpis, BoardRow, CurveFit, ModelParams, Snapshot, Validation } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The gate's own caps, handed to buildDossier so the dossier written here is the
// dossier the scorer rebuilds from the same output.
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/** Recursively copy regular files, skipping dot-names, from one dir to another. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, dst));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied.push(name);
    }
  }
  return copied;
}

/** The dashboard's data file: the whole board plus the model, as one script. */
function dataScript(snapshot: Snapshot, rows: BoardRow[], params: ModelParams, curve: CurveFit, validation: Validation, kpis: BoardKpis): string {
  const payload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      version: params.version,
      curve: {
        a: curve.a,
        b: curve.b,
        n: curve.n,
        tvl_min_usd: curve.tvl_min_usd,
        tvl_max_usd: curve.tvl_max_usd,
      },
      validation,
      summary:
        `Implied value = TVL x exp(${curve.a.toFixed(3)} + ${curve.b.toFixed(3)} x ln TVL), the log-log curve ` +
        `fitted by least squares to the ${curve.n} live-token protocols in the sealed snapshot (the multiple ` +
        `falls as TVL grows). Held out, the curve's median error is ${validation.loo.median_factor}x ` +
        `leave-one-out and ${validation.time_split.median_factor}x on the later-listed half, against ` +
        `${validation.baseline_median_loo.median_factor}x for the category-median baseline on the same test. ` +
        `The 7-day momentum, track record and chain breadth are shown for context and are NOT multiplied ` +
        `into the value: tested, they made held-out error worse. An estimate of what a launch on ` +
        `today\u2019s record would be worth, not a prediction that one will happen.`,
    },
    stats: {
      protocols_scanned: snapshot.protocols.length,
      candidates: kpis.candidates,
      watchlist_size: kpis.watchlist_size,
      watchlist_covered: kpis.watchlist_covered,
      total_implied_usd: kpis.total_implied_usd,
      median_ratio: kpis.median_ratio,
      top_implied_usd: kpis.top_implied_usd,
      median_implied_usd: kpis.median_implied_usd,
    },
    rows,
  };
  return `window.TOKEN_RADAR = ${JSON.stringify(payload)};\n`;
}

function main(): void {
  const inputFile = snapshotPath(flagValue('input', '/input'));
  if (!existsSync(inputFile)) {
    process.stderr.write(`token radar: no snapshot at ${inputFile} (pass --input <snapshot.json|dir>)\n`);
    process.exit(2);
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { rows, params, curve, validation, kpis } = buildBoard(snapshot);
  const issue = boardIssue(rows, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: refusing to hand in this board: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ version: params.version, rows, curve, validation, kpis }, null, 1)}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(snapshot, rows, params, curve, validation, kpis));

  const pageFiles = copyTree(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} images; the hand-in needs 3 (board, detail, filtered)\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: names are letters, digits and . _ -, 1-128 characters\n`);
      process.exit(1);
    }
  }

  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

  process.stdout.write(
    `token radar: scanned ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ranked ${rows.length} pre-token candidates\n` +
      `token radar: curve log(mcap/TVL) = ${curve.a.toFixed(3)} + ${curve.b.toFixed(3)} x log(TVL) on ${curve.n} live-token protocols; ` +
      `leave-one-out median error ${validation.loo.median_factor}x, later-listed half ${validation.time_split.median_factor}x, ` +
      `category-median baseline ${validation.baseline_median_loo.median_factor}x\n` +
      `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json into ${outDir}\n`,
  );
}

main();
