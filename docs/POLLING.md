# Request detail polling (env-configurable)

Polling intervals for the request detail page (sync and related SWR fetches) are defined in one place and controlled by environment variables. Same behavior in dev and prod.

## Environment variables

All are optional. Use `NEXT_PUBLIC_` prefix so the client can read them (server can read them too).

| Variable | Default | Description | Recommended range |
|----------|---------|-------------|--------------------|
| `NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_ACTIVE_MS` | 5000 | Interval (ms) when the request is in an active state (planning, applying, destroying). | 3000–15000 |
| `NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_IDLE_MS` | 15000 | Interval (ms) when the request is idle (e.g. plan_ready, approved, merged). | 10000–60000 |
| `NEXT_PUBLIC_TFPILOT_SYNC_INTERVAL_HIDDEN_MS` | 60000 | Interval (ms) when the browser tab is hidden. | 30000–120000 |
| `NEXT_PUBLIC_TFPILOT_SYNC_RATE_LIMIT_BACKOFF_MS` | 60000 | Interval (ms) used after a 429 response until the next successful fetch. | 60000–120000 |

Values are parsed as integers; they must be finite and &gt; 0, otherwise the default is used.

## Behavior

- **Single source of truth:** `lib/config/polling.ts` exports the constants and `getSyncPollingInterval(request, tabHidden)`.
- **Sync polling** (`useRequestStatus`) and **other SWR polling on the request detail page** (e.g. logs) use these intervals. No separate fixed “8s” loops.
- **Terminal status** (applied, destroyed, failed) stops polling (interval 0).
- **429 rate limit:** When the last sync error was 429, the next interval is forced to `SYNC_INTERVAL_RATE_LIMIT_BACKOFF_MS` until a successful fetch; then normal interval logic applies again.
- **Tab visibility:** When the tab is hidden, the longer `SYNC_INTERVAL_HIDDEN_MS` is used to reduce load.

## Usage

- **Config module:** `lib/config/polling.ts` — safe to import in client code (no server-only deps).
- **Sync hook:** `hooks/use-request-status.ts` — uses config and 429 backoff.
- **Detail page:** `app/requests/[requestId]/page.tsx` — logs (and any other polling) use `getSyncPollingInterval(request, tabHidden)` for `refreshInterval`.
