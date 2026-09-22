# Jev Data Analysis

Bring a dataset. Inspect its shape. See the right chart. Jev fills the values.

This is Jev data analysis: open a one-click sample, upload a CSV, or paste a public CSV URL. The UI inspects schema/shape and proposes insights; Jev still fills values. It is not a live sports product.

Start with `CURSOR.md` and `PLAN.md`. The API contract is `docs/analysis-api.md`.

## Local demo

```bash
npm install
npm run dev
```

Open the Vite URL. QA this locally — do not wait on a Production deploy. The landing page has two one-click samples — **2026 Super Bowl Demo** (P(win) line) and **Squirrel census** (places where they eat) — plus **Bring your own** (CSV upload or public HTTPS CSV URL). Entering a dataset opens `/dataset/:id` with a dashboard of 2–4 charts already running, mixing chart types on one page. Draft / Edit Jev JSON stay behind `?mode=engineer`.

Visiting or sharing a page never starts a paid Jev run. The browser never calls Jev, OpenRouter, ESPN, UploadThing, or privileged Convex writes. Tests never make a paid provider request.

## Verify

```bash
npm test
npm run test:convex
npm run typecheck
npm run typecheck:server
npm run typecheck:functions
npm run typecheck:convex
npm run build
npm run audit
```

`test:convex` uses the official `convex-test` mock runtime. It is not evidence of a deployed Convex environment.

## Sample fixtures

- `src/fixtures/footballTimeline.ts` — 71 Seattle run/pass/sack plays. Default insight is win likelihood per play (full-game rows with in-progress scores). Play quality / grading is a Score series over the same 71 plays. Validate with `npm run fixture:validate`.
- `src/fixtures/squirrelCensus.ts` — slim 2018 Central Park Squirrel Census-shaped table (lat/lng, location, eating). Default insight is **where they eat** as a places map, not Location vs Activity Choice bars.

## API

Dataset intake:

- `GET /api/datasets/status` — Convex / UploadThing / sample flags, no secrets
- `POST /api/datasets/from-csv` — upload a CSV
- `POST /api/datasets/from-url` — fetch a public HTTPS CSV
- `GET /api/datasets/<id>` — sanitized preview
- `GET /api/browse` — public dataset metadata

Analysis:

- `POST /api/analysis/draft` — server-only OpenRouter drafts an editable query; identical dataset+task hits the durable draft cache
- `POST /api/analysis/run` — starts a bounded Jev run (the only path that calls Jev)
- `GET /api/analysis/<id>` — progress snapshot
- `GET /api/share/<id>` — public readback; no provider call

After a complete run, **Download CSV** exports `row_id,probability` (Noul/Score) or `row_id,selected_class,<class…>` (Choice). Formula-like cells are escaped. Dataset-load failures show next to the chooser, not as “Couldn't run”.

Payload shapes and error codes live in `docs/analysis-api.md`.

## Operator deploy

Durable analysis, share, and dataset storage needs Convex. Production fails closed with `ANALYSIS_STORAGE_NOT_CONFIGURED` until it is provisioned. In-memory stores are for local tests only.

```bash
npx convex dev
npx convex deploy --cmd 'npm run build'
printf '%s' "$CONVEX_WRITE_SECRET" | npx convex env set CONVEX_WRITE_SECRET
```

Set these server-side. Never put secrets in a `VITE_*` variable:

```text
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_WRITE_SECRET=<operator-provisioned-secret>
CONVEX_DEPLOY_KEY=<Convex production deploy key, Vercel Production only>
OPENROUTER_KEY=<operator-provisioned-secret>
JEV_API_KEY=<operator-provisioned-secret>
UPLOADTHING_TOKEN=<UploadThing dashboard API Keys → V7 token>
```

`VITE_CONVEX_URL` is accepted as an alias for `CONVEX_URL`. Keep the same Convex write secret in Convex and the server runtime. Import the repo into Vercel as a Vite project (Node 20+).

Vercel Production uses `vercel.json` `buildCommand` `node scripts/vercel-build.mjs`. On `VERCEL_ENV=production` it requires `CONVEX_DEPLOY_KEY` and `CONVEX_WRITE_SECRET`, runs `npx convex deploy --cmd 'npm run build'`, then attempts `npx convex env set CONVEX_WRITE_SECRET`. If the deploy key lacks `deployment:env:write`, that env-set step logs a warning and the Vercel build still succeeds. Convex function deploy failures still fail the build. Set `SKIP_CONVEX_ENV_SYNC=1` to skip env-set. Preview and local Vercel builds skip Convex deploy so they cannot push to prod. A frontend-only `npm run build` leaves Convex on stale functions; BYOD then fails with Convex HTTP `[Request ID] Server Error`.

Generate the deploy key in Convex dashboard → this production deployment → Settings → Generate Production Deploy Key (enable `deployment:deploy`). Attach it to Vercel **Production only**.

BYOD CSV upload and public URL intake also need `UPLOADTHING_TOKEN`: the dashboard **API Keys → V7** token (base64 JSON `{ apiKey, appId, regions }`). A raw `sk_…` key is not enough to upload. The sample on-ramp does not need UploadThing. Caps and fail-closed codes are in `docs/analysis-api.md`.

Historical Gamecast ESPN and cron code still exists under `historical/`. Those routes are not shipped as Vercel functions.

## Safety

- Server-only modules own OpenRouter, the TypeSafe/Jev SDK, UploadThing, `JEV_API_KEY`, `OPENROUTER_KEY`, `UPLOADTHING_TOKEN`, `CONVEX_WRITE_SECRET`, `CONVEX_DEPLOY_KEY`, and the Convex HTTP client.
- The Vite build fails if those markers enter a browser chunk.
- Missing keys, invalid Convex URLs, and durable-read or intake failures fail closed. They do not silently become live success.
