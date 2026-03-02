# Useful commands — TfPilot app

Quick reference for common tasks. See [README.md](../README.md) and [DOCS_INDEX.md](DOCS_INDEX.md) for full docs.

---

## App

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Production build | `npm run build` |
| Production start | `npm run start` |
| Lint | `npm run lint` |

Dev server runs on **http://localhost:3000** by default.

---

## Postgres (local)

| Task | Command |
|------|---------|
| Start Postgres (Docker, persistent volume) | `docker compose up -d` |
| Start Postgres + run migrations | `docker compose up -d && npm run db:migrate` |
| Stop Postgres | `docker compose down` |
| Run migrations | `npm run db:migrate` |
| Rebuild index from S3 | `npm run db:rebuild-index` |
| Rebuild index + prune stale rows | `npm run db:rebuild-index -- --prune` |
| Check DB health | `curl -s http://localhost:3000/api/health/db` |
| Inspect index (few columns) | `docker exec -it tfpilot-pg psql -U tfpilot_app -d tfpilot -c "SELECT request_id, created_at, updated_at FROM requests_index;"` |
| List index table (all columns) | `docker exec -it tfpilot-pg psql -U tfpilot_app -d tfpilot -c "SELECT * FROM requests_index;"` |
| Describe table (schema) | `docker exec -it tfpilot-pg psql -U tfpilot_app -d tfpilot -c "\d+ requests_index"` |

Rebuild reads from S3, so **`.env.local` must define** `TFPILOT_REQUESTS_BUCKET` and optionally `TFPILOT_DEFAULT_REGION`.

**Env:** Set `DATABASE_URL=postgresql://tfpilot_app:localdev@localhost:5432/tfpilot` in `.env.local` (see [env.example](../env.example)).

### TablePlus (or other GUI client)

Use these values to create a new **PostgreSQL** connection:

| Field | Value |
|-------|--------|
| **Host** | `localhost` |
| **Port** | `5432` |
| **User** | `tfpilot_app` |
| **Password** | `localdev` |
| **Database** | `tfpilot` |

In TablePlus: **Create new connection** → choose **PostgreSQL** → fill the fields above → **Test** → **Connect**. Ensure Postgres is running (`docker compose up -d`).

---

## Webhook tunnel (local dev)

Expose your local app so GitHub can send webhooks. Start the app (`npm run dev`), then in another terminal:

| Tool | Command | Webhook URL |
|------|---------|-------------|
| **ngrok** | `ngrok http 3000` | `https://<subdomain>.ngrok.io/api/github/webhook` |
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://localhost:3000` | `https://<tunnel-host>/api/github/webhook` |
| **localtunnel** | `npx localtunnel --port 3000` | `https://<subdomain>.loca.lt/api/github/webhook` |

In GitHub: **Settings → Webhooks → Add webhook** → Payload URL = tunnel URL above, Content type = `application/json`, Secret = your `GITHUB_WEBHOOK_SECRET` from `.env.local`, subscribe to **Pull requests** and **Workflow runs** (and **Pushes** if needed).

---

## Tests & validation

| Task | Command |
|------|---------|
| Invariant tests (lifecycle/sync) | `npm run test:invariants` |
| Validate module registry | `npm run validate:registry` |
| Validate server tags | `npm run validate:tags` |
| Validate sync/reconcile | `npm run validate:sync-reconcile` |
| Validate derive-status | `npm run validate:derive-status` |
| Validate lock (expired) | `npm run validate:lock` |
| Validate audit events | `npm run validate:audit` |
| Validate attempt completedAt | `npm run validate:attempt-completedAt` |
| Validate needsReconcile/completedAt | `npm run validate:needsReconcile-completedAt` |

Run invariant tests before merging changes that touch lifecycle, sync, or webhooks. See [INVARIANTS.md](INVARIANTS.md).

---

## Health & API

| Task | Command |
|------|---------|
| App health | `curl -s http://localhost:3000/api/health` |
| DB health | `curl -s http://localhost:3000/api/health/db` |
| Metrics | `curl -s http://localhost:3000/api/metrics` |

---

## One-off Postgres (no Docker Compose)

If you don’t use `docker-compose.yml`:

```bash
docker run -d --name tfpilot-pg \
  -e POSTGRES_USER=tfpilot_app \
  -e POSTGRES_PASSWORD=localdev \
  -e POSTGRES_DB=tfpilot \
  -p 5432:5432 \
  postgres:12-alpine
```

No volume; data is lost when the container is removed.
