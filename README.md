# Jev Data Analysis

Turn a small CSV into a presentation-ready dashboard. The app profiles every column, picks the charts that fit the data, and gives each one a headline that states what it shows. Optionally, Jev can then read every row for insights the columns cannot answer on their own.

The built-in demos work entirely in the browser. The squirrel dashboard charts all 3,023 sightings from the public 2018 Central Park Squirrel Census; the football dashboard uses explicitly illustrative rules, not Jev predictions. Neither requires credentials or makes provider requests.

## Run locally

Use Node **22.12+ or 24** (Node 24 is used in CI).

```bash
npm ci
npm run dev
```

Open the Vite URL and pick one of the examples. Direct links are `/demo/squirrels` and `/demo/football`. Saved demo replay is also available at `/share/demo-football`. Every chart can switch to a data table and export its own CSV; blocked clipboard access reveals a selectable link. The **Ask about your columns** box reorders the dashboard to lead with the charts that answer a question, without any request.

Dropping a CSV always produces a dashboard. Without the live backend the file is charted in the browser at `/local`, never uploaded, and cleared on reload. With the live backend, uploads and public HTTPS URL intake are stored and shareable. A stored dataset shows its observed dashboard first; **Analyze dataset** explicitly starts Jev analysis. Questions the columns already answer (for example "where are squirrels eating?") are refused before any paid call. Visiting datasets, demos, or shared results never starts paid work. Advanced query editing is behind the `?mode=engineer` URL parameter; there is no link to it in the product UI.

Stored uploads and results are public. Use non-sensitive data only. Intake accepts at most **5 MB, 5,000 rows, and 100 columns**. CSV URL fetches reject credentials and private/reserved destinations, validate each redirect, pin the connection to validated DNS answers, and enforce streamed size and timeout limits.

## Validate

```bash
npm test
npm run typecheck:server
npm run typecheck:functions
npm run typecheck:convex
npm run fixture:validate
npm run audit
npm run build
npx playwright install --with-deps chromium
```

In one terminal, run `npm exec vite preview -- --host 127.0.0.1 --port 4173`. In another, run `npm run test:browser`. Set `SMOKE_BASE_URL` to use another local preview URL. The browser suite checks 30 route/theme/viewport combinations at 1440, 390, and 320 pixels, WCAG A/AA rules with axe, replay, CSV downloads, clipboard fallback, overflow, and absence of paid requests. Screenshots are saved to `artifacts/browser`. CI runs the same checks. On a headless machine without root, see `AGENTS.md` for the one-command browser setup.

Unit and Convex tests use mock providers/storage. They do not verify a provisioned production backend. See [the audit](docs/AUDIT.md) for fixes and validation limits, [the API contract](docs/analysis-api.md) for payloads, and [the working brief](CURSOR.md) for product conventions.

## Share a standalone demo

Import the repository into Vercel as a Vite project using Node 24. Set server environment **`DEMO_ONLY=1`** for the deployment. The checked-in build command then builds the frontend without deploying Convex, and the API runtime disables live dataset storage/intake and analysis even if old credentials remain present. The two local demos, export, and demo links work without any services or secrets. Route rewrites and social preview artwork are included. Social image URLs use Vercel’s deployment hostname automatically; set `PUBLIC_SITE_URL=https://<your-domain>` to use a custom canonical domain.

This is the simplest share-ready configuration. The live BYOD surface becomes available only when its services and call budgets are configured.

## Enable live BYOD

Remove `DEMO_ONLY=1`. Provision the existing Convex and UploadThing integration and set these server-only variables. Never put secrets in `VITE_*` variables.

```text
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_WRITE_SECRET=<operator-provisioned-secret>
CONVEX_DEPLOY_KEY=<production-deploy-key>
OPENROUTER_KEY=<operator-provisioned-secret>
JEV_API_KEY=<operator-provisioned-secret>
UPLOADTHING_TOKEN=<UploadThing-V7-token>
ANALYSIS_DAILY_CALL_BUDGET=1000
ANALYSIS_DAILY_DRAFT_BUDGET=100
```

The sample budgets above are illustrative operator limits. Jev accepts an integer from 1–5,000 and OpenRouter from 1–1,000. Missing or invalid budgets disable new paid calls. Convex atomically reserves permits across concurrent server instances per provider and UTC day. Failed attempts consume permits; retries are counted; SDK automatic retries are disabled. Cached drafts, joined runs, completed snapshots, and local demos require no new permits. These are call-count limits, not dollar limits. Existing saved live results remain readable when a budget is exhausted.

`ANALYSIS_ALLOW_FORCE_NEW=true` is an optional operator override for recomputation; it is disabled by default. The normal UI always reuses identical saved or running analyses.

Keep the same write secret in Convex and the server runtime. `VITE_CONVEX_URL` remains an accepted URL alias. UploadThing needs its dashboard **API Keys → V7** token containing `apiKey`, `appId`, and `regions`; a standalone raw key cannot upload.

Production `npm run build:vercel` deploys Convex functions before building the frontend and attempts write-secret synchronization. It requires `CONVEX_DEPLOY_KEY` and `CONVEX_WRITE_SECRET`. If the deploy key lacks `deployment:env:write`, set the secret in the Convex dashboard yourself; `SKIP_CONVEX_ENV_SYNC=1` skips synchronization. Preview builds never deploy Convex. A frontend-only build cannot update live backend functions.

## Fixtures and boundaries

The checked-in fixture CSVs are `/samples/seahawks-super-bowl-2026.csv` and `/samples/nyc-squirrel-census.csv`; regenerate with `npm run samples:export`. Football has 71 plays. The squirrel fixture has all 3,023 census sightings (regenerate with `node scripts/generate-squirrel-fixture.mjs`). Demo model/disclosure labels distinguish observed values, illustrative calculations, and live Jev output. Score CSV exports use `score`; Noul exports use `probability`; class exports include selected class and class probabilities. Formula-like cells are escaped.

Server modules own Jev, OpenRouter, UploadThing, and privileged Convex writes. A build guard prevents server credentials and provider endpoints from entering browser chunks. Historical ESPN/gamecast code remains under `historical/` and is outside the shipped routes.
