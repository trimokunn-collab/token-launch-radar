# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/trimokunn-collab/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/trimokunn-collab/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar — a log-log curve fit, leave-one-out tested on 128 live tokens

A radar for token launches that have not happened yet. It reads the sealed
DefiLlama snapshot of every protocol above $5M TVL, finds the ones that still
record no token of their own, prices what a launch on today's record would be
worth, and hands the reader a dashboard: a ranked board, a detail view for
every protocol, and a concrete plan for farming each one before any launch.

The value is not a category median. It is a curve fitted to the 128
tokened protocols in the snapshot — log(market cap / TVL) against log(TVL)
— and the curve's accuracy is tested, not asserted: leave-one-out median
error 3.40x, time-split 3.01x (see "Model validation" below).

An entry for make.fun's "Build the best token launch radar" bounty
($1,325 in USDC). The implied values are this board's own estimates, not
make.fun's, and not a prediction that any protocol will issue a token.

## Run it

Needs Node.js 22.18 or later (type stripping is on by default there; a newer
Node such as 24 works too). Nothing to install — standard library only.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

That writes into `out/`:

- `board.json` — the ranked board: one row per candidate with its implied
  value and its farm plan.
- `data.js` — the same board as a script, which the dashboard loads.
- `dashboard/` — the static page; open `out/dashboard/index.html` in a
  browser. It renders with no network.
- `screenshots/` — the three hand-in screenshots.
- `dossier.json` — the dossier the make.fun library builds from the page and
  the screenshots.

Run it twice: the bytes are the same both times.

## The model

Everything comes from the snapshot's own figures; no protocol is hardcoded.

1. **Universe.** A protocol is a candidate when its record carries no token
   (`gecko_id`, `symbol` and `mcap_usd` all null) and it is not a wrapped,
   staked or bridged product of a protocol whose token already trades — the
   same product test the house watchlist uses (excluded categories,
   wrapped/staked/staking name words, version-suffixed names,
   exchange-prefixed names). The board covers the whole 40-protocol watchlist
   and keeps going below its $50M floor to the snapshot's $5M edge: 198
   candidates in this snapshot.
2. **Fitted curve.** The 128 tokened protocols in the snapshot reveal how
   the market prices a dollar of TVL, and the price falls as protocols grow:
   a log-log fit (ordinary least squares) of `log(mcap_usd / tvl_usd)`
   against `log(tvl_usd)` gives

   ```
   log(mcap / TVL) = 6.965 − 0.478 · log(TVL)
   ```

   The intercept sets the level; the slope says a protocol ten times larger
   in TVL carries a multiple about a third as large. The fit uses all 128
   live-token protocols — no category, no name, no hardcoded number.
3. **Implied value.** `TVL × curve ratio`: the candidate's TVL multiplied
   by the multiple the curve predicts at that TVL. The result is an implied
   launch market value — what a token issued on today's record would be
   worth if the market priced the protocol the way it prices the live
   tokens. A candidate whose TVL lies outside the range the curve was fitted
   on is flagged as extrapolated on its row.
4. **Context, not multipliers.** A candidate's 7-day TVL momentum, its
   tokenless track record (`listed_at` to the snapshot date) and its chain
   breadth are shown on its row as context. They no longer multiply into
   the value: tested against the curve, they made the error worse
   (3.56x with them, 3.40x without), so they were dropped.
5. **Farm plan.** Five steps per protocol, generated from its category
   family, its main chain and its size: the position to open, how to grow it,
   the weekly rhythm to keep, the governance and community work, and snapshot
   hygiene — each step with a cost and a time budget.

Each row also carries a tier (S/A/B/C by TVL band) and a confidence score
that counts the evidence behind its number: the curve's leave-one-out
record, how long the record runs, and how large and steady the protocol is.

The dashboard recomputes every implied value in the browser from the same
curve and shows it beside the number `board.json` carries, so the page and
the data can be checked against each other at a glance.

## Model validation

Tested on the sealed snapshot, 128 live-token protocols. The numbers below
are the model's own output, computed by `lib/model.ts` from the snapshot
and printed with the board — they can be reproduced by running the entry.

- **Leave-one-out:** each live protocol held out once, the curve refit on
  the other 127, its market cap predicted. Median error **3.40x**; within
  2x for 32.0% of protocols, within 3x for 42.2%.
- **Time-split:** the curve fitted on listings before 2024-02-18 (47
  protocols) and tested on listings on or after that date (48 protocols).
  Median error **3.01x**; within 2x for 35.4%, within 3x for 50.0%.
- **Fitted range on every row:** each protocol's detail view shows a
  fitted range — its implied value divided and multiplied by the
  80th-percentile leave-one-out error factor (exp of the 80th-percentile
  absolute log residual across the 128 held-out protocols). 80% of the
  held-out launches landed within that factor of the curve value. It is
  display-only: it widens the estimate, it never changes the implied
  value, the ranking, or the curve. The validation panel also shows the
  time-split within-3x figure (50.0%) beside the within-2x box.
- **What changed:** the previous model priced candidates with a category
  median ratio plus growth, maturity and breadth factors. Its leave-one-out
  median error was **5.11x**. The curve alone is 3.40x; the curve with the
  three factors is 3.56x — the factors were tested and dropped.
- **Honest limit:** the snapshot is one date, so this is not a genuine
  historical walk-forward test. A one-date sample cannot establish one.
  The leave-one-out and time-split numbers are the best evidence the
  snapshot allows, and they are reported as they are — the model is a
  median-3.40x estimator, not a precise price.

## Layout

- `main.ts` — the entrypoint the grader runs.
- `lib/model.ts` — the model: universe filter, log-log curve fit, implied
  value, farm plans, board validation, validation statistics.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as the
  bounty requires.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page, no framework,
  no network.
- `screenshots/` — the board, one protocol's detail view, a filtered view.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
