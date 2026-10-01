# Jev Data Analysis working brief

The active product is CSV analysis, with credential-free examples for sharing and live BYOD when configured. Historical ESPN gamecast is outside the shipped product. Read `README.md`, `docs/AUDIT.md`, and `docs/analysis-api.md` first. `PLAN.md` preserves the original pivot history; the current rules below supersede older landing/automatic-run instructions.

- Landing pairs a clear product preview, CSV intake, and two immediately usable demo dashboards. Preserve the demo on-ramp when backend services are unavailable.
- `/demo/squirrels` shows observed counts; `/demo/football` shows explicitly illustrative rule-based values. Never present these as Jev output or proof of model accuracy. They must make no API/provider requests.
- Uploads/results are public. Show visibility and limits before intake. Accepted tables remain fully reachable through a bounded, scrollable preview.
- Dataset pages show shape and chart proposals first. Only an explicit **Analyze dataset** action begins generation/analysis. Route changes must cancel stale UI effects and prevent delayed starts.
- Dashboard tiles mix appropriate chart types. Places/counts use observed source fields and unknown values stay unknown. Do not infer eating from classifier probability. Football charts must not use CSV WPA as Jev output.
- Completed tiles export and share independently. Clipboard denial offers a selectable URL. Share/read/replay never starts paid calls. Missing live shares stay honest errors.
- Keep default copy plain. Query/JSON editing stays behind `?mode=engineer`. Error states preserve results, retry only when allowed, and recover from transient polling errors.
- Chart cursors use absolute source row indexes while transport uses completed-result indexes. Memoization must not hide edits to earlier rows. Support sparse/out-of-order results.
- Browser layout supports 320-pixel screens, light/dark themes, keyboard access, reduced motion, readable contrast, and bounded table scrolling. Avoid nested interactive roles and unnamed progress bars.
- Server-only modules own credentials, Jev/OpenRouter/UploadThing SDKs, and privileged Convex writes. Tests and browser checks never make paid provider requests.
- Public CSV fetches validate DNS/redirects, pin the connection, reject private/reserved destinations, and cap streamed bytes/time. Do not persist signed URL query strings.
- Live paid calls fail closed without durable per-provider UTC-day budgets. Count every actual attempt, disable implicit SDK retries, reuse cached/active/complete analyses, and disable force-new by default.
- `DEMO_ONLY=1` skips backend deployment and disables live services. Production live builds must deploy Convex functions. See README for all environment requirements.

Run the unit suite, all TypeScript boundaries, fixture validation, dependency audit, production build, and browser suite before release. Mock validation does not establish production provider compatibility. Pending operator work includes live provider-contract confirmation, provisioning, and authenticated/private-data workflows; do not claim these are complete.
