# Jev Playground

This repository is the **Jev Playground**: bring a dataset, ask one question of every row, watch Jev answer live. It began as "Jev Gamecast"; that product and its code are gone. The directory may still be called `jev-gamecast`.

## Read first

- `PLAN.md` — decisions, architecture, limits, and the gates that remain before the site is shared
- `docs/analysis-api.md` — the HTTP contract
- `README.md` — run, verify, deploy

## Layout

- `src/` — React app. `src/shared` and `src/dataset` are imported by both browser and server: keep them free of `node:*` imports and secrets.
- `src/server/` — the only place that reads secrets or calls a provider.
- `api/` — one thin file per Vercel function. `vite.config.ts` serves the same files during `npm run dev`.
- `convex/` — schema and functions, tested with `convex-test`.

## Rules that are easy to break

- The browser never imports from `src/server`, `convex`, or the Jev SDK. `npm run build` fails if a server-only marker reaches a browser chunk, and `src/server/browser-boundary.test.ts` walks the import graph.
- Storage writes are append-only. Do not add a call that rewrites a run's rows or sends them all again.
- Never use user-supplied text (column headers, label names) as an object key in anything stored in Convex.
- The held-out answer column must never be sent to Jev or to the drafting model.
- Only `POST /api/analysis/run` and an owner's `resume` may cause Jev calls. Reading or sharing a page never does.
- Errors shown to users are written by us. Never forward provider or storage error text.
- Simulated providers exist for local development. They are opt-in (`JEV_PLAYGROUND_MOCK=1`) and every result they produce is labelled; do not make them a silent fallback.
- Tests must not call a paid provider.

## Verify

`npm run check` — typechecks, tests, production build, sample-data check.
