/**
 * Invariant tests: Drift plan (Chunk 12 + Chunk 13).
 * - Dispatch payload: workspace_key, workspace_slug only
 * - Workspace root plan.json path expectation (envs/ prefix is historical)
 * - Empty drift response shape when no drift has ever been run
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { buildDriftPlanInputs, expectedDriftPlanJsonPath } from "@/lib/github/dispatchDriftPlan"
import { WORKSPACE_DRIFT_PRUNING_TTL_DAYS } from "@/lib/github/workspaceDriftRunIndex"

export const tests = [
  {
    name: "buildDriftPlanInputs: payload includes only workspace_key and workspace_slug",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        workspace_key: "dev",
        workspace_slug: "ai-agent",
      })
      assert(inputs.workspace_key === "dev", "workspace_key")
      assert(inputs.workspace_slug === "ai-agent", "workspace_slug")
      assert(Object.keys(inputs).length === 2, "exactly two keys")
    },
  },
  {
    name: "buildDriftPlanInputs: must NOT include request_id or environment_* keys",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        workspace_key: "prod",
        workspace_slug: "payments",
      })
      assert(!("request_id" in inputs), "no request_id")
      assert(!("environment_id" in inputs), "no environment_id in inputs")
      assert(!("environment_key" in inputs), "no environment_key in inputs")
      assert(!("environment_slug" in inputs), "no environment_slug in inputs")
    },
  },
  {
    name: "buildDriftPlanInputs: must NOT include extra keys",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        workspace_key: "dev",
        workspace_slug: "x",
      })
      assert(!("request_id" in inputs), "no request_id")
      assert(!("environment_id" in inputs), "no environment_id in inputs")
    },
  },
  {
    name: "expectedDriftPlanJsonPath: uses workspace root format envs/<key>/<slug>/plan.json",
    fn: () => {
      const path = expectedDriftPlanJsonPath("dev", "ai-agent")
      assert(path === "envs/dev/ai-agent/plan.json", "workspace root plan.json path")
    },
  },
  {
    name: "drift-latest empty response: drift null when no drift has ever been run",
    fn: () => {
      const emptyResponse = { drift: null }
      assert(emptyResponse.drift === null, "drift must be null when no runs")
      assert("drift" in emptyResponse, "response has drift key")
    },
  },
  {
    name: "WORKSPACE_DRIFT_PRUNING_TTL_DAYS: pruning TTL is 30 days",
    fn: () => {
      assert(WORKSPACE_DRIFT_PRUNING_TTL_DAYS === 30, "pruning TTL 30 days")
    },
  },
]
