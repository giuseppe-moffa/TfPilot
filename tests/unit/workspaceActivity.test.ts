/**
 * Unit tests: buildWorkspaceActivity.
 * Pure builder; no GitHub/S3/DB.
 */

import { buildWorkspaceActivity } from "@/lib/workspaces/activity"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const BASE_WS = { workspace_key: "dev", workspace_slug: "ai-agent" }

export const tests = [
  {
    name: "buildWorkspaceActivity: empty requests",
    fn: () => {
      const r = buildWorkspaceActivity({
        workspace: BASE_WS,
        deployStatus: { deployed: true },
        requests: [],
      })
      assert(Array.isArray(r.activity), "activity is array")
      assert(r.activity.length === 1, "one deploy event")
      assert(r.activity[0].type === "workspace_deployed", "type")
      assert(typeof r.activity[0].timestamp === "string", "timestamp ISO")
    },
  },
  {
    name: "buildWorkspaceActivity: deploy PR open",
    fn: () => {
      const r = buildWorkspaceActivity({
        workspace: BASE_WS,
        deployStatus: { deployPrOpen: true, deployPrUrl: "https://x.com/pr/1" },
        requests: [],
      })
      assert(r.activity.length === 1, "one event")
      assert(r.activity[0].type === "workspace_deploy_pr_open", "type")
      assert(r.activity[0].pr_url === "https://x.com/pr/1", "pr_url")
    },
  },
  {
    name: "buildWorkspaceActivity: deploy check failed omits deploy events + warning",
    fn: () => {
      const r = buildWorkspaceActivity({
        workspace: BASE_WS,
        deployStatus: {
          deployed: true,
          deployPrOpen: true,
          deployCheckFailed: true,
        },
        requests: [],
      })
      assert(r.activity.length === 0, "no deploy events when check failed")
      assert(r.warning === "WORKSPACE_DEPLOY_CHECK_FAILED", "warning set")
    },
  },
  {
    name: "buildWorkspaceActivity: rows with different workspace_slug are excluded by caller",
    fn: () => {
      const r = buildWorkspaceActivity({
        workspace: BASE_WS,
        deployStatus: { deployed: false },
        requests: [
          {
            request_id: "req_1",
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-01T00:00:00Z",
            module_key: "s3",
            pr_number: 1,
          },
        ],
      })
      assert(r.activity.length >= 1, "request event present")
    },
  },
]
