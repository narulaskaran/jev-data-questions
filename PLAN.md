# Jev Playground — plan and current state

> **For agents:** the product is the **Jev Playground** (bring a dataset, ask one question of every row). Read this file and `CURSOR.md` before changing code. `docs/analysis-api.md` is the HTTP contract. The old live-ESPN "Gamecast" product and all of its code have been removed; do not revive it.

**Last updated:** 2026-10-01

**Status:** feature-complete locally and verified in a real browser in simulated mode. Not yet deployed. Nothing has been run against a real Convex deployment, Vercel, Jev or OpenRouter — see "Before sharing the link".

## Promise

> Ask one question of every row.

Pick a dataset → write (or draft) a question and labels → explicit **Run** → answers arrive live → replay, inspect, export, share.

## Decisions (recorded)

1. **Visibility.** Anonymous, and everything is public: datasets, runs and results are readable by anyone with the link. The upload card says so. There are no accounts and no deletion flow.
2. **Limits.** 4 MB, 5,000 rows, 100 columns per dataset. One Jev call per row, so a run costs at most 5,000 calls. 4 MB (not 5) because Vercel caps a function's request body at 4.5 MB.
3. **Classifier contract.** One `choice` question per row. Each label has a name and a one-line description, which is sent to Jev as the criterion. Stored per row: label, per-label probabilities when Jev gives usable ones, confidence, latency, or an error code.
4. **Public links.** `https://` on port 443 only, no credentials, public addresses only, checked at connect time on every redirect hop.
5. **Sample.** The Seahawks Super Bowl LX play-by-play stays, reframed as "run or pass?": every play is a row, only pre-snap fields are inputs, and the actual call is held out to score Jev. (The earlier framing — classify first-half plays into player names — had no per-row ground truth and hid the names the labels depended on.)
6. **Held-out answer column.** Any dataset can nominate a column that Jev never sees and that is used only to score answers.
7. **Storage.** Convex only. UploadThing was removed: the original blob was written and never read, while gating uploads on a second credential.
8. **Realtime.** The browser polls a cursor (`?after=`). It does not hold a Convex client, which keeps Convex out of the browser bundle.

## Non-goals

No accounts, private data, SQL/notebooks, connectors, or claims that Jev's answers are accurate or calibrated. No automatic runs: opening or sharing a page never starts paid work.

## Architecture

```text
browser ── /api/* (Vercel functions, src/server) ── Convex (storage)
                         ├── OpenRouter (draft the question and labels)
                         └── Jev (one call per row)
```

- **Append-only runs.** Each answered row is one inserted document. Progress is a counter patch in the same transaction. Nothing rewrites earlier rows, so cost is linear in rows.
- **Chunked execution.** An invocation takes a 60 s lease, classifies in small parallel batches for ~40 s, releases, and POSTs to `/api/analysis/continue` (HMAC-authenticated) so a fresh invocation carries on. The lease is renewed on every write, so two workers cannot process the same run.
- **Failure handling.** A failed row is stored as failed and the run continues. Five consecutive failures stop the run as `error`. The creator's browser holds a control token and can resume or cancel. A lost hand-off shows as "stalled" and is resumable.
- **Rows as arrays.** Dataset rows are value arrays aligned with the column list, and probabilities are arrays aligned with the labels. User text is never a storage field name.
- **Reads.** Result rows are joined with dataset rows on read, paged by cursor and by a byte budget. Finished runs are CDN-cacheable.

## Spend and abuse controls

| Control | Default | Variable |
|---|---|---|
| Kill switch | off | `JEV_RUNS_DISABLED=1` |
| Jev calls per UTC day, all users | 20,000 | `JEV_DAILY_CALL_BUDGET` |
| Rows per run | 5,000 | `JEV_MAX_ROWS_PER_RUN` |
| Runs per hour per client address | 10 | `JEV_RUNS_PER_HOUR` |
| Drafts per hour per client address | 30 | `JEV_DRAFTS_PER_HOUR` |
| Uploads per hour per client address | 20 | `JEV_UPLOADS_PER_HOUR` |
| Parallel Jev calls per run | 2 | `JEV_CONCURRENCY` |

Counters live in Convex. A run reserves its whole call count against the daily budget before it starts. Client addresses are stored only as salted hashes.

## Before sharing the link

These cannot be verified from a laptop and are the remaining gates:

- [ ] `npx convex deploy` succeeds and the functions behave as they do under `convex-test` (which does not enforce every production limit or validator).
- [ ] On Vercel: `req.body` for `application/octet-stream` arrives as a Buffer; `maxDuration: 60` is accepted on the project's plan; the self-call to `/api/analysis/continue` reaches the production domain (set `JEV_PUBLIC_ORIGIN` if deployment protection blocks it).
- [ ] One real Jev call on the sample confirms the response shape `parseJevAnswer` expects (`answers.classification.{choice, probabilities, confidence}`), and a full 71-row run completes.
- [ ] One real OpenRouter draft confirms `response_format: json_object` works with the configured model.
- [ ] Pick the daily budget and per-hour limits deliberately. The defaults allow 20,000 calls a day.
- [ ] Decide whether a public, anonymous, paid endpoint is acceptable at all, or whether the first shared link should run in simulated mode.

## Open product questions

- No deletion or takedown path for public uploads.
- "Retry failed rows" does not exist: resume continues after the last stored row.
- The browse API returns recent runs, but no page lists them (user-written text on the landing page needs moderation first).
- Runs of several thousand rows at concurrency 2 take tens of minutes; raise `JEV_CONCURRENCY` once Jev's rate limits are known.
