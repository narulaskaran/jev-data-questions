# Agent notes

Product rules and conventions live in `CURSOR.md`. Read it first. `README.md` has the run/validate commands. This file records the tooling facts that are slow to rediscover.

## Checks before a PR

```bash
npm ci
npm test && npx tsc -b            # unit tests and the app typecheck
npm run typecheck:server && npm run typecheck:functions && npm run typecheck:convex
npm run build
```

`npm test` makes no network or paid-provider calls. Never add a test or script that does.

## Looking at the UI

Hosts that run agents are usually headless, without root, and the T3 Code `preview_*` tools report "No preview automation host". Use Playwright from the shell instead. The setup script below also installs its Chromium, but the OS libraries and fonts it needs are often missing (`error while loading shared libraries: libglib-2.0.so.0`, or a crash right after launch).

One-time setup per checkout (no sudo, needs network, about 10 MB):

```bash
npm run browser:setup        # fetches libs into .local/browser (gitignored)
. .local/browser/env.sh      # sets LD_LIBRARY_PATH and FONTCONFIG_FILE; repeat in each new shell
```

Then:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 &      # or: npm exec vite preview -- --port 4173
npm run shoot                                      # landing, both demos and the replay, 1440 + 390 px, light + dark
npm run shoot -- /demo/squirrels --widths 320 --schemes dark
```

Screenshots land in `.local/shots` (override with `--out`; point at another server with `--base` or `SMOKE_BASE_URL`). Open them with the Read tool. The helper stubs `/api/**` the way the smoke suite does, so the app runs in its no-backend demo mode.

Full browser suite (axe, overflow, downloads, no paid requests): build, run `npm exec vite preview -- --host 127.0.0.1 --port 4173`, then `. .local/browser/env.sh && npm run test:browser`.

Notes:
- `scripts/browser-setup.sh` is written for Ubuntu/Debian (`apt-get download` + `dpkg -x`, nothing installed system-wide). If it reports unresolved libraries, add the owning package to its list.
- The dev server and screenshot files are throwaway. Kill the server when done and keep `.local/` out of commits.
