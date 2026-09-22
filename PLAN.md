# Jev Dataset Analysis — MVP Implementation Plan

> **For agents:** The active product is **Jev Data Analysis**, not a live football gamecast. Read this file and `CURSOR.md` before writing code. `docs/analysis-api.md` is the current fixture-first API contract. Do not revive ESPN live-feed gamecast as the product, and do not restart the MVP from a blank repo.

> **For Hermes:** Use the Kanban workflow and independent review/QA gates. P0 product decisions below are recorded. Implementation is already in progress on `origin/main`; continue from the current workbench rather than Stage 0 scaffolding.

**Status:** Pivot recorded. Fixture-first analysis plus Stage 5 BYOD intake (CSV upload, public HTTPS CSV URL, sample on-ramp) and a scrubbable live class-distribution run view (sample and BYOD share the same shell) is on the working branch. Remaining work is pause/cancel, browse/share completeness, abuse/cost controls, and production/release gates. Stage 0 provider-contract confirmation is still pending before paid live Jev.

**Last updated:** 2026-09-19 13:50:00 UTC

**Goal:** Let a user bring a small CSV dataset, inspect its schema/shape, run a proposed insight (Jev still fills values; advanced users can edit raw Jev JSON), watch results arrive live in the matching chart, and share/replay the completed analysis at a unique URL.

**Architecture:** The browser validates and previews CSV input, but never calls Jev, OpenRouter, UploadThing server credentials, or privileged Convex mutations directly. UploadThing stores the original CSV blob; Convex stores dataset/analysis metadata, immutable normalized row references, run progress, and incremental predictions for realtime display and replay. A server-only OpenRouter adapter turns the user’s natural-language task into a structured, editable Jev query. A bounded server worker processes rows in small leased chunks, persists each result atomically, and schedules the next chunk so a large run does not depend on one long-lived Vercel request.

**Tech stack:** Existing React + TypeScript + Vite frontend; Vercel server/API routes; Convex cloud for durable metadata, realtime queries, leases, and progress; UploadThing for CSV blobs; OpenRouter for normal-LLM query drafting; server-only TypeSafe/Jev classifier adapter; local CSS and dependency-light visualizations; Vitest and browser QA.

### Project identity

- Product name: **Jev Data Analysis**.
- Intended Vercel project: `jev-data-analysis`.
- Canonical git remote: `origin` (`jev-data-questions`).
- Historical local directory names such as `jev-gamecast` are leftover from the previous product and do not change the active product.

### Already on `origin/main` (do not rebuild)

Treat these as landed starting points, not future tasks:

- Fixture-first analysis UI in `src/App.tsx`: sample football dataset, query draft/edit, explicit run, progress, scrubbable live class chart, processed-row rail, secondary results table, and share/replay readback.
- Server analysis API: `POST /api/analysis/draft`, `POST /api/analysis/run`, `GET /api/analysis/<id>`, `GET /api/share/<id>` (`docs/analysis-api.md`).
- Checked-in Seahawks Super Bowl fixture with H1 model inputs and H2 evaluation labels (`src/fixtures/footballTimeline.ts`). Sample win-likelihood / Noul uses the full 71-play SEA slice with in-progress scores; H1 leakage rules stay on the yards-evaluation path.
- Server-only OpenRouter draft adapter and Jev classifier adapter; browser bundles must stay free of credentials and provider SDKs.
- Convex analysis snapshot persistence plus leftover Gamecast forecast tables/cron. Gamecast ESPN routes are historical; do not extend them as the product.

Gaps versus this plan: pause/cancel status is still incomplete, leftover Gamecast forecast/ESPN code still exists under `historical/`, paid live Jev remains fail-closed until operator provisioning and provider-contract confirmation, and UploadThing/Convex production secrets are operator-provisioned (BYOD fails closed without them).

---

## 1. Product pivot and explicit boundary

The active product is no longer a live football gamecast. The old ESPN/game-state/gamecast surface is historical implementation material only. Preserve useful server-only Jev, persistence, idempotency, and fail-closed patterns where they apply. The first MVP intentionally uses one sanitized football time-series fixture as a sample dataset, but must not carry ESPN-specific concepts, live-feed labels, routes, or product copy into the general BYOD experience.

### Product promise

> Bring a dataset. Inspect its shape. See the right chart. Jev fills the values.

The product should feel like a clear analysis workbench, not an AI-agent control panel. Chart type is chosen from data shape (categorical / numeric / time / geo / cardinality), not a fixed Choice-bars vs Noul-line pairing. The primary flow is:

```text
landing page (Dynamic insights from your data.)
  → choose 2026 Super Bowl Demo, Squirrel census, or BYOD
  → /dataset/:id dashboard (2–4 tiles start in parallel; skeletons OK)
  → quiet schema strip + dataset preview under the tiles
  → diverse chart types on one page (fail if every tile is the same viz)
  → Seahawks: SEA win probability + SEA play quality on one page (plus a non-series tile)
  → Squirrel lead: Where they eat places map (never AM/PM class bars)
  → optional Engineer (`?mode=engineer`): Edit Jev JSON / Draft task / Run Jev
```

### MVP scope

- The first MVP release uses one checked-in, sanitized football time-series fixture. It is deterministic and requires no upload, URL fetch, ESPN call, or external dataset rights.
- The fixture contains sequential rows representing game-state checkpoints/events and is shaped exactly like a future user dataset.
- CSV upload and direct public HTTPS CSV intake remain the next BYOD expansion stage; their full requirements stay in this plan but are not prerequisites for the first working demo.
- One analysis task per run.
- Enter/Open a dataset starts the dashboard fan-out (one Jev run per tile). Visiting `/` or a share URL never starts a paid run.
- One Jev classifier decision per accepted row unless the final contract requires a different batching model.
- Natural-language task drafting through a normal OpenRouter LLM; generated query is reviewable and manually editable before execution.
- Live progress through Convex realtime updates, with a current-row panel and an incremental chart/table.
- Every analysis has a stable shareable URL and a replayable immutable result history.
- Landing page entry points in the first slice: try the sample dataset and browse the sample analysis. Add upload/provide-a-dataset entry points when BYOD intake is implemented.
- Convex stores sample-dataset metadata, progress, and results in the first slice. UploadThing is deferred until user-supplied CSVs are enabled. Do not add Neon or Redis for MVP.
- Each project has one public dataset listing and one public analysis listing in MVP; future private/unlisted modes are out of scope until identity/access control exists.

### Explicit non-goals

- No live ESPN or other external sports-feed ingestion in the first MVP; football appears only as a sanitized fixture domain.
- No arbitrary browser-to-Jev calls.
- No automatic Jev execution from page load, social preview generation, or public browsing.
- No unbounded dataset size, row count, concurrency, retry loop, or spend.
- No authenticated Google Drive/S3/database connectors in MVP.
- No SQL editor, Python notebook, arbitrary code execution, or user-defined model tools.
- No claim that Jev outputs are calibrated, causal, accurate, or suitable for high-stakes decisions.
- No private dataset contents in logs, analytics, URLs, OpenGraph metadata, or error reports.
- No secrets, provider tokens, cookies, or connection strings in Git or browser bundles.

---

## 2. P0 decisions required before implementation

These questions materially change the data model, abuse controls, and UI. Record the answers in this file before dispatching implementation tasks.

1. **Visibility and identity — DECIDED:** Anonymous creation with every dataset and analysis public by default. The MVP must show a clear public-data warning before any future upload and must never expose secrets, credentials, or private provider responses. Deletion/abuse controls remain a launch risk because there is no owner account.
2. **Execution cap — DECIDED:** Maximum 5,000 accepted rows and 5,000 Jev calls per analysis. This is a hard server-side ceiling, not a promise that every user may run 5,000 calls without additional global throttling or budget approval. The run confirmation must show the maximum call count; concurrency, retry policy, and global quota remain enforced server-side.
3. **Jev classifier contract — DECIDED:** Each row produces a selected class, per-class probabilities, and confidence when Jev provides it; no free-form explanation by default. The implementation must generalize the existing typed `Choice` adapter from hard-coded football outcomes to dynamic user-defined classes, subject to the confirmed Jev API contract.
4. **CSV URLs — DECIDED:** Accept public HTTPS URLs that directly return CSV. No cookies, authorization headers, authenticated/private links, or arbitrary URL fetches.
5. **Result visualization — DECIDED:** Chart type follows dataset shape, then the proposed insight. Noul/Score on a sequential play-state table render a live scrubbable series over play/row index (sample win likelihood is Noul P(win) 0–1, not CSV `wpa`; play quality / grading is Score over the same play index, not Choice Good/Bad on H1). Place/eating tables (squirrel census) render **places**: a lat/lng map when coordinates exist, otherwise ranked bars of location values — never Location vs Activity Choice bars. Choice classifiers render class-distribution bars when that is actually the insight. The `Row X of Y` rail is only for row-streamed series/bars. Progress percent chrome stays. Empty series/bars: chart axes + “Waiting for the first row…”; places can plot dataset coordinates immediately.
6. **Sample datasets — DECIDED:** Two one-click samples. Seahawks fixture stays as the Super Bowl demo (win likelihood → P(win) line). **Squirrel census** is the second sample (slim checked-in fixture exercising place/eating/lat-lng). Default squirrel insight is where they eat. BYOD upload + public HTTPS CSV URL also ships. Idle: Super Bowl · Squirrel census + Bring your own. Do not drop the football fixture while adding the second sample.

### Working defaults pending provider-contract confirmation

- Every dataset and analysis is public by default. The landing page warns that the sample, future uploaded content, and derived results will be publicly browseable. Do not imply deletion or privacy guarantees that the anonymous model cannot provide.
- No authentication in the first vertical slice. Before production launch, add abuse controls sufficient for public-by-default paid execution, including rate limits, global quotas, a kill switch, and a decision on whether anonymous users may consume Jev budget.
- Public CSV URLs only; no cookies, authorization headers, or arbitrary URL fetches.
- 5 MB maximum file size, 5,000-row maximum execution, an explicit column cap such as 100 columns, and bounded row/field lengths. Byte size alone is never the Jev cost limit.
- Bounded Jev pool (concurrency 6, clamped 1–8), pipelined Convex snapshot puts, bounded retries, no speculative duplicate calls, and visible Cancel/Pause controls. A 5,000-call run must require explicit confirmation and remain subject to a global daily/project budget.
- Recommended results are classified labels plus provider-returned probabilities/confidence when available; explanations are not requested unless the confirmed Jev contract requires them.
- OpenRouter drafts a typed query object, not executable code. The user edits the serialized query in a text area, and server validation rejects malformed or unsafe edits.
- Convex realtime queries are the “stream”; do not hold an SSE connection open for the full run.

---

## 3. User-visible experience

### Landing page and sample dataset

The first screen should communicate one action:

> Bring a dataset. Ask a question. See Jev work through it.

Primary actions in the first release:

- Try the sample football dataset.
- Browse the sample dataset.
- Browse the sample analysis/replay.

Future BYOD actions, enabled only after the sample vertical slice passes review:

- Upload CSV.
- Use a public CSV link.
- Browse public user datasets and analyses.

Keep the page sparse and editorial. Do not reuse the rejected Gamecast dashboard hierarchy or decorative AI-agent chrome. Show a short privacy/cost disclosure before upload and a stronger run-cost confirmation immediately before Jev execution.

### Dataset source roadmap

First release:

1. Load exactly one checked-in fixture through a typed `FixtureDatasetSource`.
2. Display its schema, row count, representative rows, timestamps, and event labels before task drafting.
3. Keep fixture rows immutable and deterministic; no network or user data is needed to reproduce the demo.

BYOD expansion:

1. File picker accepts `.csv`; drag/drop is optional but must not be the only path.
2. URL form accepts only `https://` and clearly explains that the URL must be public and directly return CSV data.
3. Client reads at most the configured byte limit, detects encoding/delimiter/header shape, previews the first bounded rows, and reports actionable validation errors.
4. Client validation is advisory only. The server downloads/reads the source again, applies the same and stricter checks, hashes the source, and stores immutable dataset metadata.
5. Preview must make it obvious which row is the header, how many rows/columns were accepted, and what was truncated or rejected.
6. CSV content is treated as untrusted data. Escape formula-like values in any spreadsheet-style export and never execute cell contents.

### Task and query drafting

1. User enters a natural-language question or task, for example: “Classify support tickets as urgent or routine using the message and customer tier.”
2. Browser submits the task plus dataset schema/sample—not the entire dataset—to a server-only OpenRouter route.
3. OpenRouter returns strict structured output containing:
   - task summary;
   - target label/decision;
   - allowed classes or classifier options;
   - row fields to use;
   - null/missing-value policy;
   - serialized Jev classifier query;
   - warnings when the request is ambiguous or unsuitable.
4. The browser displays the generated query in an editable text box and preserves both generated and edited versions.
5. Server validates the final edited query against the confirmed Jev contract immediately before run. The query is data, not code; no tools or arbitrary instructions are executed.
6. User must explicitly click `Run Jev`. Confirmation shows dataset name, accepted row count, query text/hash, maximum Jev calls, concurrency, and the fact that results may contain sensitive data supplied by the user.

### Live analysis view

The analysis page has a stable URL before, during, and after execution. It contains:

- analysis title and explicit `RUNNING`, `PAUSED`, `COMPLETE`, `CANCELLED`, or `ERROR` state;
- progress count and bounded estimate, never fabricated completion;
- live class-distribution chart (hero, scrubbable) and a secondary result table;
- processed-row rail listing `Row X of Y` only (no CSV cell dump);
- current prediction, confidence/probabilities, latency, attempt, and error state when available;
- recent result list and latest update timestamp;
- pause/cancel control with durable state transition;
- a `Replay` action after at least one persisted result exists;
- public-data disclosure and deletion-request controls separate from execution.

The UI must distinguish:

- dataset upload/fetch time;
- query-draft time;
- Jev request start/end time;
- persistence time;
- client observation/realtime update time;
- replay clock time.

Never imply that rows not yet processed have a prediction. Partial runs remain valid, labeled partial, and replayable.

### Replay and sharing

- Each analysis ID is opaque and non-sequential in public URLs.
- Replay uses persisted immutable per-row results and never calls Jev.
- Replay supports play/pause, step, scrub, current-row focus, endpoint-disabled controls, keyboard operation, and reduced-motion behavior.
- Shared pages show only data permitted by the analysis visibility setting.
- Add OpenGraph/Twitter metadata using the analysis title and aggregate result summary only; never include raw row text or provider secrets in metadata.
- Sharing is passive: visiting a URL never reruns or resumes a job.

---

## 4. Data and state contracts

### Dataset metadata

For the first fixture release, store the fixture key and sanitized metadata in Convex. For the later BYOD expansion, store only metadata and a durable UploadThing object reference, not an unbounded duplicate copy of the CSV:

```ts
Dataset {
  id: opaque id
  sourceType: "fixture" | "upload" | "public_url"
  displayName: string
  fixtureKey?: string
  blobKey?: string
  sourceUrl?: string // sanitized/public URL only; omit credentials/query secrets
  byteSize: number
  contentHash: string
  encoding: string
  delimiter: string
  columns: Array<{ name: string; normalizedName: string; inferredType: string }>
  acceptedRowCount: number
  previewRows: SanitizedPreviewRow[]
  validationWarnings: string[]
  visibility: "published"
  createdAt: number
  publishedAt?: number
}
```

Do not store raw source URLs containing credentials. Do not expose UploadThing keys or internal blob URLs to the browser unless the SDK requires a short-lived signed URL.

### Analysis metadata

```ts
Analysis {
  id: opaque id
  datasetId: DatasetId
  title: string
  naturalLanguageTask: string
  generatedQuery: JsonValue
  editedQuery: JsonValue
  queryHash: string
  queryWarnings: string[]
  rowCount: number
  maxCalls: number
  callsReserved: number
  callsCompleted: number
  rowsCompleted: number
  status: "draft" | "queued" | "running" | "paused" | "complete" | "cancelled" | "error"
  visibility: "published"
  createdAt: number
  startedAt?: number
  completedAt?: number
  lastErrorCode?: string
}
```

### Immutable prediction record

```ts
Prediction {
  analysisId: AnalysisId
  rowIndex: number
  rowHash: string
  rowPreview?: SanitizedRow // only if visibility policy allows it
  result: JsonValue
  selectedClass?: string
  probabilities?: Record<string, number>
  confidence?: number
  latencyMs?: number
  providerRequestId?: string // opaque provider ID only, no prompt or secret
  attempt: number
  idempotencyKey: string // analysisId + rowIndex + queryHash + datasetHash
  observedAt: number
  createdAt: number
}
```

### State transitions

```text
draft → queued → running → complete
                         ↘ paused → running
                         ↘ cancelled
                         ↘ error
```

- `queued` reserves the bounded call budget atomically.
- A row may transition to `processing` only under a durable lease.
- A successful prediction is written exactly once by idempotency key.
- A provider timeout may retry within the bounded attempt policy; it may not create a second successful record.
- A worker lease expires only after the configured timeout and can be reclaimed safely.
- `cancelled` is terminal for the current run; already persisted predictions remain replayable.
- `error` records a stable public error code and keeps completed predictions.
- Completion requires `rowsCompleted === acceptedRowCount` or an explicit terminal partial/cancelled state.

---

## 5. Server boundaries and abuse controls

### Browser boundary

The browser may call only browser-safe routes/queries for:

- upload initialization/finalization;
- dataset metadata and sanitized preview;
- query draft request;
- analysis creation/start/pause/cancel;
- public analysis read and realtime prediction subscription.

The browser must never import or bundle:

- `JEV_API_KEY`, `OPENROUTER_KEY`, `UPLOADTHING_TOKEN`, `CONVEX_DEPLOY_KEY`, `CRON_SECRET`, or server-only environment access;
- TypeSafe/Jev SDK internals;
- OpenRouter SDK or privileged provider clients;
- private Convex write functions or admin APIs.

Add a build-time browser-boundary test and a production bundle marker scan.

### Dataset validation and URL safety

Revalidate all inputs on the server:

- byte size and decompressed size limits;
- maximum row count, column count, cell length, and total parsed memory;
- UTF-8 and delimiter handling;
- duplicate/empty header policy;
- malformed quote/newline behavior;
- content type plus magic/content sniffing;
- redirect count and final-host validation;
- block localhost, loopback, link-local, private, metadata, non-HTTP(S), and unsafe IPv6 destinations;
- fetch timeout and response streaming limit;
- no authorization headers from user input;
- no logging of raw rows or URLs with query credentials.

Treat CSV cells as untrusted prompt data. Delimit row values clearly, cap serialized row size, and ensure row text cannot override the classifier contract or cause tool execution.

### OpenRouter boundary

- Keep `OPENROUTER_KEY` server-side.
- Use a configured allowlisted model from server environment; do not let the browser select arbitrary provider/model IDs.
- Require strict JSON/schema validation and reject malformed or extra fields.
- Bound task length, schema/sample size, timeout, retries, and draft rate.
- Store prompt version and model ID, but never raw provider authorization headers.
- A draft failure must not enqueue Jev work.

### Jev boundary

- Keep `JEV_API_KEY` and the Jev client server-side.
- Use the confirmed classifier query contract from the P0 decision.
- One user action creates at most the configured row-call budget.
- Reserve budget durably before work; do not trust process-local counters.
- Use durable row leases, idempotency keys, bounded concurrency, bounded retries, and a kill switch.
- Do not auto-retry an unknown provider outcome unless the idempotency contract proves it safe.
- No provider call occurs in tests, replay, public browsing, or page load.
- Display provider errors as unavailable/partial rather than inventing a result.

### Privacy and publication

- Warn users not to upload sensitive/personal data until retention and deletion controls are implemented.
- Every MVP record is public and appears in browse queries only after safe metadata/row-output policy is applied.
- Raw rows must still be excluded from sitemap, OpenGraph metadata, analytics, and logs; future private/unlisted states require a separate identity/access-control design.
- Provide delete/cancel semantics or explicitly mark them as a pre-launch limitation; do not claim deletion if the UploadThing blob remains.
- Use opaque IDs and avoid raw row values in URLs, logs, exceptions, and telemetry.

---

## 6. Proposed repository structure

Keep the new domain separate from historical football code until migration is complete:

```text
src/
  fixtures/
    footballTimeline.ts
    footballTimeline.test.ts
  dataset/
    csvTypes.ts
    parseCsv.ts
    validateDataset.ts
    dataset.test.ts
  query/
    queryTypes.ts
    queryValidation.ts
    queryDraftClient.ts
    query.test.ts
  analysis/
    analysisTypes.ts
    analysisState.ts
    analysis.test.ts
  browser/
    datasetClient.ts
    analysisClient.ts
    realtimeResults.ts
  components/
    LandingPage.tsx
    DatasetIntake.tsx
    DatasetPreview.tsx
    QueryComposer.tsx
    RunConfirmation.tsx
    AnalysisProgress.tsx
    ResultsChart.tsx
    RowRail.tsx
    ResultsTable.tsx
    BrowseCards.tsx
  App.tsx
  styles.css

api/
  datasets/prepare.ts
  datasets/finalize.ts
  query/draft.ts
  analyses/create.ts
  analyses/[id]/start.ts
  analyses/[id]/pause.ts
  analyses/[id]/cancel.ts

convex/
  schema.ts
  datasets.ts
  analyses.ts
  predictions.ts
  runner.ts
  browse.ts
  _generated/

src/server/
  openrouter.ts
  jevClassifier.ts
  uploadthing.ts
  datasetFetch.ts
  analysisRunner.ts
  analysisBudget.ts
  analysisLease.ts

src/persistence/
  analysisStore.ts
```

Modify existing shared server/browser boundaries only after checking all current imports. Do not rename or delete historical modules in the first slice solely for cleanliness; isolate the new routes and then remove football routes in a separately reviewed cleanup task.

---

## 7. Delivery stages and acceptance gates

### Stage 0 — Product contract, fixture, and provider probes

**Owner:** product + researcher/architect

- Confirm the checked-in football time-series fixture schema and the five P0 product decisions.
- Inspect the current repository and preserve the approved server-only boundary patterns.
- Confirm Jev classifier request/response, limits, pricing, idempotency, and safe retry behavior with one harmless fixture row only if credentials are deliberately configured.
- Confirm OpenRouter structured-output behavior with a mocked contract first; no user data or production secrets in fixtures.
- Defer UploadThing account/configuration until BYOD intake; verify Convex deployment identity through secure provider settings.
- Document retention, publication, deletion, and public-display policy.

**Gate:** exact schemas, row/call caps, visibility model, and provider boundaries are known; no secrets committed; no paid probe unless explicitly approved.

### Stage 1 — Hardcoded football time-series vertical slice

**Owner:** coder; independent reviewer; bug-basher

- Create one checked-in, sanitized, immutable football timeline fixture with stable row IDs, timestamps, event labels, and representative state fields.
- Implement `FixtureDatasetSource` and a preview that renders the fixture schema and rows without network access.
- Implement Convex metadata/result boundaries against local fakes; do not add UploadThing yet.
- Add tests for fixture ordering, deterministic hashes, timestamp monotonicity, missing-value policy, immutable rows, and no future-state leakage.

**Gate:** a fresh browser can select the hardcoded football sample, inspect its rows/schema, and proceed to task drafting with no network or provider call.

### Stage 2 — Natural-language query composer

**Owner:** coder; independent contract reviewer

- Add server-only OpenRouter adapter and strict query-draft schema.
- Build task entry UI, draft loading/error/ambiguity states, editable serialized query, and final-query validation.
- Persist generated query, edited query, schema version, model ID, and hashes without raw secrets.
- Add mocked provider tests covering valid output, malformed JSON, refusal/ambiguity, oversized output, prompt-injection-like cells, timeout, and retry limits.

**Gate:** a user can produce and manually edit a valid Jev query; invalid or unsafe query edits cannot reach the run endpoint.

### Stage 3 — Bounded Jev row runner

**Owner:** coder; security/cost reviewer

- Implement Convex analysis schema, durable budget reservation, row leases, idempotency, chunk scheduling, pause/cancel, and terminal states.
- Implement server-only Jev classifier adapter behind a fake provider for tests.
- Process rows in bounded chunks, persist each prediction atomically, and expose realtime progress.
- Add adversarial tests for duplicate starts, concurrent workers, restart/reclaim, slow/hung provider, timeout, unknown outcome, budget exhaustion, cancellation, query changes, and cross-analysis isolation.

**Gate:** one explicit run consumes no more than the reserved budget; each row produces at most one persisted prediction; a worker restart cannot duplicate paid work; no browser bundle contains provider markers.

### Stage 4 — Live analysis UI and replay

**Owner:** coder; visual reviewer; bug-basher

- Build stable analysis route with progress, scrubbable class-distribution chart, processed-row rail, secondary results table, error/partial states, and pause/cancel controls.
- Add Convex realtime subscription and reconnect/catch-up behavior.
- Add durable replay using stored predictions only; replay must never call Jev.
- Verify 320px, 390px, desktop, keyboard, reduced-motion, no-overflow, long-label, empty-result, and partial-run behavior.

**Gate:** a fresh browser can watch a mocked analysis update row-by-row, identify the current row, pause/cancel, reload without losing progress, and replay completed predictions offline.

### Stage 5 — BYOD intake expansion and browse/shareability

**Owner:** coder; product/UX reviewer

- Add CSV file upload and public-URL intake without disturbing the working hardcoded fixture path.
- Add UploadThing blob storage and Convex dataset metadata only after server-side validation passes.
- Replace the sample-only landing actions with the full BYOD landing page.
- Add browse public datasets and browse public analyses queries.
- Add opaque analysis URLs, public-by-default disclosure, safe title/summary metadata, and Twitter/OpenGraph cards without raw rows.
- Add explicit public-data/retention copy and test that every browseable record has safe metadata and output visibility.

**Gate:** public browse shows only permitted metadata/output; raw rows never enter social metadata or logs; shared analysis URL loads the exact persisted run without starting a new run.

### Stage 6 — Production configuration and deployment

**Owner:** ops; independent release reviewer

- Provision/verify Convex production deployment and official generated bindings.
- Configure OpenRouter, Jev, Convex, Vercel, and cron/worker environment variables only through encrypted provider settings; configure UploadThing only when the BYOD expansion is enabled.
- Configure server-only runtime routes and an authenticated bounded continuation mechanism; do not rely on one long-lived Vercel request.
- Deploy the exact reviewed `origin/main` SHA; read back Vercel deployment ID, canonical URL, Convex deployment identity, build logs, and environment variable names without values.
- Keep live Jev disabled until the operator deliberately provisions the key and cost limits.

**Gate:** exact deployment SHA and provider identities match; replay works without keys; live execution fails closed when a required key/config is absent; no paid Jev call is used merely as a smoke test.

### Stage 7 — Independent production QA and release

**Owner:** bug-basher; separate from implementer and ops

- Fresh-browser test sample landing, fixture preview, query draft mock, run confirmation, live mocked progress, pause/cancel, reload/reconnect, replay, browse, and share URL.
- After the BYOD expansion, add upload/link validation and UploadThing readback to this matrix.
- Verify browser network/bundle contains no Jev/OpenRouter/UploadThing credentials or server endpoints that bypass authorization.
- Verify production limits, no automatic run on page load, duplicate-run protection, budget exhaustion, row-level failure, provider outage, Convex outage, and stale worker recovery.
- Separate replay-only evidence from live provider evidence. Never label a mocked run as a live Jev result.
- Capture exact URL, deployment ID, SHA, Convex identity, test outputs, residual risks, and release status.

**Gate:** explicit PASS against the exact production deployment, or actionable FAIL routed to a bounded repair. No “released” claim without exact readback and fresh production QA.

---

## 8. Test and verification matrix

### Deterministic automated tests

- CSV parser and validator fixtures at byte/row/column/cell limits.
- Client/server validation parity.
- URL safety and SSRF rejection.
- Query-draft schema and final-query validation.
- OpenRouter adapter mapping with fake provider.
- Jev adapter mapping with fake provider.
- Analysis state transitions and terminal states.
- Durable budget reservation and lease reclaim.
- Idempotent prediction persistence.
- Cross-analysis and cross-dataset isolation.
- Pause/cancel/restart/timeout/unknown-outcome behavior.
- Convex schema/functions and generated bindings.
- Browser/server import boundary and production bundle marker scans.
- Privacy/secret/PII scans and `git diff --check`.

### Browser and visual checks

At minimum test 320×844, 390×844, and 1440×900:

- first-screen promise and intake actions;
- fixture preview legibility and horizontal containment;
- query editor readability and explicit run confirmation;
- live chart/table/current-row hierarchy;
- pause/cancel focus and keyboard operation;
- replay endpoint affordances and reduced motion;
- public-by-default data disclosure;
- no document horizontal overflow;
- no blocking console/network errors.

### Provider and production checks

- No real provider call in unit/browser tests.
- OpenRouter live probe only with deliberate operator approval and a synthetic schema/row.
- Jev live probe only with deliberate operator approval, a synthetic row, and a recorded budget reservation; never use a production user dataset.
- UploadThing upload/readback with a harmless fixture.
- Convex durable read/write across fresh requests and worker restart simulation.
- Vercel deployment/build readback and exact SHA match.
- Production smoke test starts in replay/mock mode, not paid live mode.

---

## 9. Operational limits and unresolved risks

### Initial limits to enforce

- CSV source: 5 MB maximum; server-side byte limit is authoritative.
- Bounded preview: small fixed number of rows and columns.
- Bounded task/query lengths and OpenRouter draft frequency.
- Explicit maximum rows/calls per analysis from the P0 decision.
- Concurrency 2 or lower until measured provider behavior supports more.
- Maximum retry attempts and per-row timeout.
- Durable per-analysis and global daily budget reservations.
- Maximum active analyses per anonymous identity/IP/device fingerprint only if privacy review approves the mechanism.
- Manual kill switch for all Jev execution.

### Known risks

- A 5 MB CSV can contain many rows; byte size alone is not a sufficient Jev cost limit.
- Vercel request duration and Convex scheduling semantics must be tested with the current deployment plan.
- UploadThing retention/deletion semantics must be verified before promising deletion.
- Public CSV URLs can change between validation and execution; hash and source snapshot identity must be recorded.
- CSV rows may contain personal or confidential data and prompt-injection text.
- Jev classifier output may not provide probabilities or may have provider-specific limits; UI must degrade to labels/table without fabricating confidence.
- OpenRouter output can be malformed or semantically unsuitable; strict schema validation and user review are mandatory.
- Anonymous public creation can be abused to consume provider budgets; authentication/rate limits or a conservative anonymous quota may be required before enabling paid execution.
- Realtime progress can lag the worker; UI must display observation age and never claim a row is complete before durable readback.

---

## 10. Release checklist

- [ ] P0 scope questions answered and recorded.
- [ ] Product/UX review approves the BYOD flow and label budget.
- [ ] Hardcoded fixture validation and no-future-leakage tests pass.
- [ ] BYOD expansion: CSV client/server validation and public-URL SSRF/content/size protections pass.
- [ ] OpenRouter query drafting is server-only and schema-validated.
- [ ] Final query is editable but cannot execute arbitrary code/tools.
- [ ] Jev classifier contract is confirmed and adapter tests pass.
- [ ] Durable budget, idempotency, leases, retries, pause/cancel, and kill switch pass adversarial tests.
- [ ] Convex realtime progress and replay pass fresh-browser checks.
- [ ] BYOD expansion: UploadThing object reference and retention behavior are verified.
- [ ] Public-by-default browse/share behavior and safe output disclosure are verified.
- [ ] No secrets, raw PII, or provider internals reach Git, bundles, URLs, logs, or social metadata.
- [ ] Exact reviewed SHA is pushed and read back from `origin/main`.
- [ ] Exact production deployment ID, URL, Convex identity, build logs, and SHA are read back.
- [ ] Production QA explicitly passes the exact deployed artifact.
- [ ] Any live Jev run is separately labeled and backed by real provider evidence.

**Current next gate:** operator-provision UploadThing + Convex for BYOD, then harden pause/cancel, public browse/share completeness, abuse/cost controls, and provider-contract confirmation before Stage 6. Canonical remote is `origin` (`jev-data-questions`); product/Vercel name remains `jev-data-analysis`. Do not dispatch implementation against the old live-ESPN gamecast plan.
