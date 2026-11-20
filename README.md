# Token Launch Radar

A radar for token launches that have not happened yet. It reads the sealed
DefiLlama snapshot of every protocol above $5M TVL, finds the ones that still
record no token of their own, prices what a launch on today's record would be
worth, and hands the reader a dashboard: a ranked board, a detail view for
every protocol, and a concrete plan for farming each one before any launch.

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
2. **Comparable ratio.** Launched protocols reveal what the market pays per
   dollar of TVL (`mcap_usd / tvl_usd`). Each candidate is priced with the
   median ratio of its own category (3+ launched peers), else of a family of
   like categories, else of every launched protocol in the snapshot.
3. **Implied value.** `TVL x ratio x momentum x track record x breadth`:
   momentum rewards a rising 7-day TVL (clamped, so one wild week cannot
   dominate), track record rewards a long tokenless run (`listed_at` to the
   snapshot date), breadth adds a small premium per extra chain. The result is
   an implied launch market value — what a token issued on today's record
   would be worth if the market priced the protocol like its peers.
4. **Farm plan.** Five steps per protocol, generated from its category
   family, its main chain and its size: the position to open, how to grow it,
   the weekly rhythm to keep, the governance and community work, and snapshot
   hygiene — each step with a cost and a time budget.

Each row also carries a tier (S/A/B/C by TVL band) and a confidence score
that counts the evidence behind its number: how many launched peers priced
it, how long the record runs, and how large and steady the protocol is.

The dashboard recomputes every implied value in the browser from the same
formula and shows it beside the number `board.json` carries, so the page and
the data can be checked against each other at a glance.

## Layout

- `main.ts` — the entrypoint the grader runs.
- `lib/model.ts` — the model: universe filter, comparable ratios, implied
  value, farm plans, board validation.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as the
  bounty requires.
- `dashboard/` — `index.html`, `app.css`, `app.js`: the page, no framework,
  no network.
- `screenshots/` — the board, one protocol's detail view, a filtered view.

## License

MIT — see `LICENSE`.
