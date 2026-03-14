# Insights — Platform Observability Dashboard

The Insights page (`/insights`) provides a dashboard of platform metrics and GitHub API usage for operators and developers. It requires an authenticated session.

**Navigation:** Via nav bar → **Insights** (or `/insights`).

---

## What the dashboard shows

### 1. Ops metrics (request-based)

Aggregates derived from Postgres request index + S3. **Org-scoped:** requires `session.orgId`; returns 403 "Organization archived" when org is archived. Data source: bounded list of requests (cap ~1000) for the current org.

| Metric | Description |
|--------|-------------|
| **Total requests** | Count in the capped list |
| **Status distribution** | Counts by canonical display status (e.g. request_created, planning, plan_ready, applied, failed) |
| **Failures (24h / 7d)** | Requests with status `failed` in time window (by `updatedAt`) |
| **Applies (24h / 7d)** | Apply success count; current attempt `dispatchedAt` in window |
| **Destroys (24h / 7d)** | Destroyed/destroying requests in window |
| **Apply success rate (7d)** | Apply success / (success + failures) |
| **Plan success rate (7d)** | Plan success / (success + failures) |
| **Avg / P95 apply duration (7d)** | Seconds from `dispatchedAt` → `completedAt` for apply attempts |
| **Avg Created → Plan ready (7d)** | Seconds from `receivedAt` to plan attempt `completedAt` |

### 2. GitHub API usage (in-memory)

Metrics recorded at a single call-site: **lib/github/client.ts** `ghResponse()`. Resets on app deploy/restart; no persistence.

| Metric | Description |
|--------|-------------|
| **5m / 60m windows** | Rolling aggregates: calls, rate-limited responses, success/client/server/fetch errors |
| **Last-seen rate limit** | `remaining` / `limit`, `reset` (Unix timestamp), `observedAt` |
| **Top routes (60m)** | Up to 8 normalized routes by call count |
| **Hot routes (5m)** | Top 5 routes in last 5 minutes |
| **Rate-limit burst (5m)** | `true` if any rate-limited response in 5m **or** `remaining/limit < 10%` |
| **Last rate-limit events** | Ring of last 20 events; each: route, status, remaining/limit/reset, optional **kindGuess** |

**kindGuess** — Best-effort label from normalized path (e.g. `run`, `pr`, `reviews`, `jobs`, `workflow`, `contents`, `dispatch`, `commits`). See `inferKindGuess()` in **lib/observability/github-metrics.ts**.

---

## API endpoints

| Endpoint | Auth | Response | Notes |
|---------|------|----------|------|
| `GET /api/metrics/insights` | Session + org required | `{ success: true, metrics: OpsMetricsPayload }` | Org-scoped ops metrics; cached ~60s; 403 when org archived |
| `GET /api/metrics/github` | Session required | `GitHubMetricsSnapshot` | In-memory snapshot; no cache |

---

## Code layout

| File / folder | Role |
|---------------|------|
| **app/insights/** | Insights page UI (`InsightsDashboard.tsx`) |
| **lib/observability/ops-metrics.ts** | Builds `OpsMetricsPayload` from request list |
| **lib/observability/github-metrics.ts** | In-memory GitHub usage, route normalization, `inferKindGuess()` |
| **lib/observability/useInsightsMetrics.ts** | SWR hook for `GET /api/metrics/insights` |
| **lib/observability/useGitHubMetrics.ts** | SWR hook for `GET /api/metrics/github` |
| **app/api/metrics/insights/route.ts** | Serves ops metrics; 60s in-memory cache; `listRequests()` → `buildOpsMetrics()` |
| **app/api/metrics/github/route.ts** | Serves `getGitHubMetricsSnapshot()` |

---

## Caching and freshness

- **Ops metrics:** In-memory cache TTL 60 seconds. Warm cache < ~1s; cold cache < ~3s (S3 list + document reads).
- **GitHub metrics:** No cache; snapshot reflects current process state.

---

## Future: Workspace deployment analytics

Future versions of Insights will use the **workspace_runs** projection for: deploy frequency per workspace; success/failure ratios; drift frequency; MTTR; workspace activity timelines. Current Insights remain request-based today.

---

## Related docs

- **docs/SYSTEM_OVERVIEW.md** — Observability and Insights section
- **docs/GLOSSARY.md** — Observability terms (Insights, GitHub API usage, rate-limit burst, kindGuess)
- **docs/SCREAMING_ARCHITECTURE.md** — `lib/observability/` and `app/insights/` layout
