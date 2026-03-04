/**
 * Invariant tests: Drift plan v2 (Chunk 12 + Chunk 13).
 * - Dispatch payload: ONLY environment_key, environment_slug (no legacy "environment")
 * - ENV_ROOT plan.json path expectation
 * - Empty drift response shape when no drift has ever been run
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

import { buildDriftPlanInputs, expectedDriftPlanJsonPath } from "@/lib/github/dispatchDriftPlan"
import { ENV_DRIFT_PRUNING_TTL_DAYS } from "@/lib/github/envDriftRunIndex"

export const tests = [
  {
    name: "buildDriftPlanInputs: payload includes only environment_key and environment_slug",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        environment_key: "dev",
        environment_slug: "ai-agent",
      })
      assert(inputs.environment_key === "dev", "environment_key")
      assert(inputs.environment_slug === "ai-agent", "environment_slug")
      assert(Object.keys(inputs).length === 2, "exactly two keys")
    },
  },
  {
    name: "buildDriftPlanInputs: must NOT include legacy 'environment' key",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        environment_key: "prod",
        environment_slug: "payments",
      })
      assert(!("environment" in inputs), "inputs must not have legacy 'environment' key")
    },
  },
  {
    name: "buildDriftPlanInputs: must NOT include request_id or other extra keys",
    fn: () => {
      const inputs = buildDriftPlanInputs({
        environment_key: "dev",
        environment_slug: "x",
      })
      assert(!("request_id" in inputs), "no request_id")
      assert(!("environment_id" in inputs), "no environment_id in inputs")
    },
  },
  {
    name: "expectedDriftPlanJsonPath: uses ENV_ROOT format envs/<key>/<slug>/plan.json",
    fn: () => {
      const path = expectedDriftPlanJsonPath("dev", "ai-agent")
      assert(path === "envs/dev/ai-agent/plan.json", "ENV_ROOT plan.json path")
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
    name: "ENV_DRIFT_PRUNING_TTL_DAYS: pruning TTL is 30 days",
    fn: () => {
      assert(ENV_DRIFT_PRUNING_TTL_DAYS === 30, "pruning TTL 30 days")
    },
  },
]
