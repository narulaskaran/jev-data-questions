# Jev Playground HTTP API

All routes are Vercel functions under `api/`. They return JSON. The browser calls only these routes; it never calls Jev, OpenRouter or Convex.

## Errors

Every failure has the same shape:

```json
{ "error": "RATE_LIMITED", "message": "You have reached this playground's hourly run limit. Please try again later.", "retryable": true }
```

`error` is a stable code. `message` is written for people and is safe to display. Upstream error text (provider or storage) is never forwarded. `429` responses carry `Retry-After` when the wait is known.

Common codes: `STORAGE_NOT_CONFIGURED` (503), `JEV_NOT_CONFIGURED` (503), `DRAFTING_NOT_CONFIGURED` (503), `RUNS_DISABLED` (503), `RATE_LIMITED` (429), `DAILY_BUDGET_EXHAUSTED` (429), `RUN_TOO_LARGE` (413), `NOT_RUN_OWNER` (403), `ANALYSIS_NOT_FOUND` (404), `DATASET_NOT_FOUND` (404), `INTERNAL_ERROR` (500).

## Status

`GET /api/status`

```json
{
  "storage": true,
  "drafting": "live",
  "classifier": "live",
  "runsEnabled": true,
  "limits": { "maxRows": 5000, "maxBytes": 4194304, "maxColumns": 100 }
}
```

`drafting` and `classifier` are `live`, `mock` (simulated, explicit opt-in) or `off`. No secret or variable name is returned.

## Datasets

A dataset is immutable once stored. Rows are arrays aligned with `columns`.

`POST /api/datasets/upload?filename=tickets.csv` — body is the raw file bytes (`Content-Type: application/octet-stream`). Returns `201` with a preview.

`POST /api/datasets/from-url` — `{ "url": "https://example.com/data.csv" }`. Returns `201` with a preview.

`GET /api/datasets/<datasetId>` — the preview. The sample's ID is `sample-super-bowl-lx-run-pass`.

```json
{
  "datasetId": "…",
  "sourceType": "upload",
  "displayName": "tickets.csv",
  "byteSize": 51234,
  "delimiter": ",",
  "columns": [{ "name": "message", "inferredType": "string" }],
  "acceptedRowCount": 600,
  "previewRows": [["Where is my order?"]],
  "validationWarnings": ["3 rows had fewer cells than the header and were padded."]
}
```

Limits: 4 MB, 5,000 rows, 100 columns, 8,192 characters per cell. The 4 MB cap sits below the platform's request-body limit so an accepted file can always be posted.

Parsing rules worth knowing:

- Delimiter is detected from the header (`,` tab `;` `|`). A quote only opens a quoted field at the start of the field, so `5" wide` is ordinary text.
- A column is a number only if every value survives the round trip. `02139` and 19-digit IDs stay text.
- Short rows are padded and extra cells dropped, and both are reported in `validationWarnings`.

Public links must be `https://` on port 443 with no credentials. The server resolves the host itself and refuses private, loopback, link-local, metadata and other non-public addresses (IPv4 and IPv6, including IPv4-mapped and NAT64 forms). The check is applied to the address the socket actually connects to, on every redirect hop, and the body is streamed with a hard cap.

Stable intake codes: `CSV_TOO_LARGE`, `NOT_CSV`, `CSV_PARSE_FAILED`, `CSV_EMPTY`, `CSV_TOO_MANY_ROWS`, `CSV_TOO_MANY_COLUMNS`, `CSV_INVALID_HEADER`, `URL_NOT_PUBLIC`, `URL_UNSAFE`, `URL_FETCH_FAILED`, `DATASET_STORAGE_FAILED`.

## Draft a question

`POST /api/analysis/draft`

```json
{ "datasetId": "…", "task": "Sort tickets into urgent and routine.", "labelColumn": "priority" }
```

Returns an editable starting point. It does not start a run and does not call Jev.

```json
{
  "datasetId": "…",
  "query": "Is this ticket urgent?",
  "classes": [
    { "name": "Urgent", "description": "Needs a reply today." },
    { "name": "Routine", "description": "Can wait." }
  ],
  "model": "openai/gpt-4o-mini",
  "mode": "live"
}
```

The drafting model sees the task, the column names, and at most 5 rows of 40 columns with cells clipped to 200 characters. The held-out label column is removed first; if it has 12 or fewer distinct values they are offered as the label set.

## Start a run

`POST /api/analysis/run`

```json
{
  "datasetId": "…",
  "query": "Is this ticket urgent?",
  "classes": [{ "name": "Urgent", "description": "Needs a reply today." }, { "name": "Routine", "description": "" }],
  "labelColumn": "priority"
}
```

Returns `202`:

```json
{ "analysis": { "analysisId": "…", "status": "queued", "…": "…" }, "controlToken": "…" }
```

This is the only route that starts paid work. One Jev call is made per row. `labelColumn` is optional; that column is never sent to Jev and is only used by the browser to score answers.

`controlToken` is returned once. It lets its holder cancel or resume this run. Only its hash is stored.

Before accepting, the server checks: the kill switch, the per-run row limit, the per-client hourly run limit, and the daily Jev call budget (the whole run is reserved up front).

## Read a run

`GET /api/analysis/<analysisId>?after=<rowIndex>`

Public. Returns metadata plus stored rows with `rowIndex > after` (default `-1`), oldest first, at most 500 per read and fewer for very wide rows.

```json
{
  "analysis": {
    "analysisId": "…",
    "datasetId": "…",
    "datasetName": "tickets.csv",
    "sourceType": "upload",
    "query": "Is this ticket urgent?",
    "classes": [{ "name": "Urgent", "description": "…" }, { "name": "Routine", "description": "" }],
    "columns": ["message", "priority"],
    "labelColumn": "priority",
    "status": "running",
    "mode": "live",
    "createdAt": 1790000000000,
    "updatedAt": 1790000004200,
    "startedAt": 1790000000900,
    "progress": { "totalRows": 600, "completedRows": 42, "failedRows": 1 }
  },
  "rows": [
    {
      "rowIndex": 0,
      "values": ["Where is my order?", "Routine"],
      "model": "jev-latest",
      "selectedClass": "Routine",
      "probabilities": [0.18, 0.82],
      "confidence": 0.82,
      "latencyMs": 640
    }
  ],
  "nextAfter": 0,
  "hasMore": true,
  "serverTime": 1790000004300
}
```

- `values` is aligned with `analysis.columns`; `probabilities` with `analysis.classes`.
- Pass `nextAfter` as the next `after`. When `hasMore` is true, read again immediately.
- `status` is `queued`, `running`, `complete`, `error` or `cancelled`.
- A row that Jev could not answer is stored with `error: { code, retryable }` and no label. One bad row does not stop the run; five in a row do, with status `error`.
- A run is stalled when it is `running` but `serverTime - updatedAt` exceeds 90 seconds.
- Reads of finished runs are cacheable; reads of live runs are `no-store`.

## Control a run

`POST /api/analysis/cancel` and `POST /api/analysis/resume`, both with `{ "analysisId": "…", "controlToken": "…" }`.

Cancel stops the worker at its next write and keeps the answers so far. Resume restarts a run that stopped on errors or stalled, continuing from the next unanswered row.

`POST /api/analysis/continue` is internal: one invocation hands a long run to the next. It requires a per-run HMAC header and cannot restart a run that stopped on an error.

## Browse

`GET /api/browse` returns the 24 newest runs and datasets (metadata only).

## Storage model

Convex holds everything durable:

- `datasets` and `datasetChunks` — metadata, and rows in chunks of value arrays.
- `analyses` — one document per run: metadata, progress counters, the run lease.
- `analysisRows` — one document per answered row. Rows are only ever inserted.
- `rateLimits`, `budgets` — abuse and spend counters.

User-supplied text (column headers, label names) is never used as a field name, so any header works. Every write requires `CONVEX_WRITE_SECRET`. Reads of public data need no secret.
