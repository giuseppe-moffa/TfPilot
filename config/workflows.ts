/**
 * Workflow file names — single source of truth: lib/config/env.ts.
 * Re-exported here for backwards compatibility; prefer importing env from "@/lib/config/env".
 */
import { env } from "@/lib/config/env"

export const PLAN_WORKFLOW = env.GITHUB_PLAN_WORKFLOW_FILE
export const APPLY_WORKFLOW = env.GITHUB_APPLY_WORKFLOW_FILE
export const DESTROY_WORKFLOW = env.GITHUB_DESTROY_WORKFLOW_FILE
export const CLEANUP_WORKFLOW = env.GITHUB_CLEANUP_WORKFLOW_FILE
