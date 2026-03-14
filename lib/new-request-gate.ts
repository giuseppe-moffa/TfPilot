/**
 * Client-side gating for "New Request" based on workspace/environment deploy status.
 * Use API fields only; no new deploy detection logic.
 */

export type DeployStatusFromApi = {
  deployed?: boolean
  deployPrOpen?: boolean | null
  error?: string
}

export type NewRequestGateResult = {
  allowed: boolean
  message?: string
}

const DEPLOY_CHECK_FAILED_ERRORS = new Set([
  "ENV_DEPLOY_CHECK_FAILED",
  "WORKSPACE_DEPLOY_CHECK_FAILED",
])

/**
 * Determine if "New Request" is allowed and the message to show when blocked.
 * Rules:
 * - deployed=true AND deployPrOpen=false → allow
 * - deployPrOpen=true → block "Workspace deployment in progress"
 * - deployed=false (no error) → block "Workspace must be deployed before creating resources"
 * - error === *_DEPLOY_CHECK_FAILED → block "Cannot verify deploy status"
 */
export function getNewRequestGate(status: DeployStatusFromApi | null): NewRequestGateResult {
  if (!status) {
    return { allowed: false, message: "Select a workspace" }
  }
  if (status.error && DEPLOY_CHECK_FAILED_ERRORS.has(status.error)) {
    return { allowed: false, message: "Cannot verify deploy status" }
  }
  if (status.deployPrOpen === true) {
    return { allowed: false, message: "Workspace deployment in progress" }
  }
  if (status.deployed === false) {
    return { allowed: false, message: "Workspace must be deployed before creating resources" }
  }
  if (status.deployed === true && status.deployPrOpen === false) {
    return { allowed: true }
  }
  return { allowed: false, message: "Cannot verify deploy status" }
}
