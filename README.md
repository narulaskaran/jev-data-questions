# Jev Playground

Ask one question of every row.

Pick a dataset, write a question and a short list of labels, and Jev answers the question for each row. Answers arrive live. Every run has its own link, can be replayed, and can be downloaded as a CSV.

This is a demo for trying Jev on your own data. It is not production analytics, and everything in it is public.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. With no keys configured, `npm run dev` runs the whole product in **simulated mode**:

- storage is in the dev server's memory (it resets when the server restarts);
- drafting and classification come from built-in stand-ins, so nothing is spent;
- every simulated result is labelled "Simulated" in the UI and in the data.

Put real keys in `.env.local` (see `.env.example`) to use Convex, Jev and OpenRouter instead. The dev server serves `api/*.ts` the same way Vercel does, so there is nothing else to start.

## What you can do

- **Try the sample.** Every Seattle play from Super Bowl LX (71 rows). Jev sees only the situation before the snap and predicts run or pass. The real call is held out and used to score it.
- **Bring a CSV.** Upload a file (up to 4 MB, 5,000 rows, 100 columns) or paste a public `https://` link.
- **Score against a column.** If your data already contains the right answer, pick that column. Jev never sees it; the run page shows accuracy, a simple baseline, and a confusion matrix.
- **Write or draft the question.** Type the question and labels yourself, or describe the task and let the drafting model fill them in. Both stay editable.
- **Watch, replay, export, share.** The run page updates as rows are answered. Scrub or replay the run, inspect any row (inputs, answer, per-label probabilities), download the results, or copy the link.

## Verify

```bash
npm run check
```

That runs every typecheck, the test suite, the production build (which fails if anything server-only reaches a browser chunk), and checks that the sample dataset matches the pinned source fixture. `npm run audit` checks dependencies.

Tests never call a paid provider. The Convex functions are tested with `convex-test`, which is a mock runtime, not a deployed Convex.

## Deploy

The app is a Vite site plus Vercel functions under `api/`, with Convex for storage.

1. **Convex.** `npx convex deploy`, then set the shared secret on the deployment:
   `npx convex env set CONVEX_WRITE_SECRET "$(openssl rand -hex 32)"`.
2. **Vercel.** Import the repo as a Vite project (Node 22) and set, server-side:

   | Variable | Needed for |
   |---|---|
   | `CONVEX_URL` | storage (the `https://<name>.convex.cloud` URL; `VITE_CONVEX_URL` also works) |
   | `CONVEX_WRITE_SECRET` | storage (same value as on Convex) |
   | `JEV_API_KEY` | running Jev |
   | `OPENROUTER_KEY` | drafting the question and labels (optional) |

3. Decide the spend limits before sharing the link. Defaults: 20,000 Jev calls per UTC day across everyone, 10 runs per hour per client address, 5,000 rows per run. See `.env.example` for every knob, including the kill switch `JEV_RUNS_DISABLED=1`.

Without storage the site still loads and the sample can be previewed, but uploads and runs are refused. Without `JEV_API_KEY` runs are refused. Nothing silently falls back to fake results: simulated mode only exists when `JEV_PLAYGROUND_MOCK=1` is set explicitly, and it is labelled everywhere.

Long runs do not depend on one long request. Each function invocation classifies rows for about 40 seconds, stores them, and hands the run to a fresh invocation. If a hand-off is lost, the run page shows it as stalled and the browser that started it can resume it.

## How it is built

- `src/` — the React app. `src/shared` and `src/dataset` are shared with the server and must stay browser-safe.
- `src/server/` — everything that touches a secret: the analysis worker, providers, limits, HTTP handlers.
- `api/` — one thin file per Vercel function.
- `convex/` — schema and functions. Rows are stored append-only; nothing is rewritten as a run progresses.
- `docs/analysis-api.md` — the HTTP contract.
- `PLAN.md` — decisions, limits and what is still open.

The browser never talks to Jev, OpenRouter or Convex, and never receives a key. Dataset rows are untrusted input: they are sent to Jev as data, exported with spreadsheet-formula characters neutralised, and never rendered as HTML.

## Sample data

The sample is derived from nflverse play-by-play data (CC BY 4.0). `src/fixtures/data/seahawks-super-bowl-2026.json` is the pinned source slice; `npm run sample:generate` derives the compact sample the app ships, and `npm run sample:check` fails if the two drift apart.
