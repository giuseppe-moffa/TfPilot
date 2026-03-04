/**
 * Unit tests: buildEnvironmentActivity.
 * Pure builder; no GitHub/S3/DB.
 */

import { buildEnvironmentActivity } from "@/lib/environments/activity"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const BASE_ENV = { environment_key: "dev", environment_slug: "ai-agent" }

export const tests = [
  {
    name: "buildEnvironmentActivity: empty requests",
    fn: () => {
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: { deployed: true },
        requests: [],
      })
      assert(Array.isArray(r.activity), "activity is array")
      assert(r.activity.length === 1, "one deploy event")
      assert(r.activity[0].type === "environment_deployed", "type")
      assert(typeof r.activity[0].timestamp === "string", "timestamp ISO")
    },
  },
  {
    name: "buildEnvironmentActivity: deploy PR open",
    fn: () => {
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: { deployPrOpen: true, deployPrUrl: "https://x.com/pr/1" },
        requests: [],
      })
      assert(r.activity.length === 1, "one event")
      assert(r.activity[0].type === "environment_deploy_pr_open", "type")
      assert(r.activity[0].pr_url === "https://x.com/pr/1", "pr_url")
    },
  },
  {
    name: "buildEnvironmentActivity: deploy check failed omits deploy events + warning",
    fn: () => {
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: {
          deployed: true,
          deployPrOpen: true,
          deployCheckFailed: true,
        },
        requests: [],
      })
      assert(r.activity.length === 0, "no deploy events when failed")
      assert(r.warning === "ENV_DEPLOY_CHECK_FAILED", "warning")
    },
  },
  {
    name: "buildEnvironmentActivity: request_created from requests",
    fn: () => {
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: {},
        requests: [
          {
            request_id: "req_abc123",
            created_at: "2026-02-01T12:00:00Z",
            updated_at: "2026-02-01T12:00:00Z",
            module_key: "s3-bucket",
            pr_number: 42,
          },
        ],
      })
      assert(r.activity.length === 1, "one event")
      assert(r.activity[0].type === "request_created", "type")
      assert(r.activity[0].request_id === "req_abc123", "request_id")
      assert(r.activity[0].module === "s3-bucket", "module")
      assert(r.activity[0].pr_number === 42, "pr_number")
    },
  },
  {
    name: "buildEnvironmentActivity: rows with different environment_slug are excluded by caller",
    fn: () => {
      // The builder receives pre-filtered rows from listRequestIndexRowsByEnvironment(repo, key, slug).
      // Rows for other slugs are never passed. This test verifies only passed rows appear.
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: {},
        requests: [
          {
            request_id: "req_matching_ai_agent",
            created_at: "2026-02-01T12:00:00Z",
            updated_at: "2026-02-01T12:00:00Z",
            module_key: "s3-bucket",
            pr_number: 1,
          },
        ],
      })
      assert(r.activity.length === 1, "only matching-env request appears")
      assert(r.activity[0].request_id === "req_matching_ai_agent", "correct request")
    },
  },
  {
    name: "buildEnvironmentActivity: newest first",
    fn: () => {
      const r = buildEnvironmentActivity({
        env: BASE_ENV,
        deployStatus: { deployed: true, deployTimestamp: "2026-02-02T00:00:00Z" },
        requests: [
          {
            request_id: "req_old",
            created_at: "2026-02-01T10:00:00Z",
            updated_at: "2026-02-01T10:00:00Z",
            module_key: null,
            pr_number: null,
          },
          {
            request_id: "req_new",
            created_at: "2026-02-01T14:00:00Z",
            updated_at: "2026-02-01T14:00:00Z",
            module_key: null,
            pr_number: null,
          },
        ],
      })
      assert(r.activity.length === 3, "deploy + 2 requests")
      const times = r.activity.map((e) => e.timestamp)
      assert(
        new Date(times[0]).getTime() >= new Date(times[1]).getTime(),
        "newest first"
      )
      assert(
        new Date(times[1]).getTime() >= new Date(times[2]).getTime(),
        "newest first"
      )
    },
  },
]
