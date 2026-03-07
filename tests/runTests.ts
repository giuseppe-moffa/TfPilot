/**
 * Minimal test runner. Executes all tests (invariants, unit, API routes);
 * exits non-zero if any test throws.
 * Run: npm run test
 */

import { tests as reconcileTests } from "./invariants/reconcile.test"
import { tests as completionTimeTests } from "./invariants/completionTime.test"
import { tests as auditDeterminismTests } from "./invariants/auditDeterminism.test"
import { tests as locksTests } from "./invariants/locks.test"
import { tests as environmentsHelpersTests } from "./invariants/environmentsHelpers.test"
import { tests as rendererModel2Tests } from "./invariants/rendererModel2.test"
import { tests as requestEnvironmentTests } from "./invariants/requestEnvironment.test"
import { tests as envDestroyTests } from "./invariants/envDestroy.test"
import { tests as envFieldsChunk9Tests } from "./invariants/envFieldsChunk9.test"
import { tests as model2LegacyTests } from "./invariants/model2Legacy.test"
import { tests as driftPlanTests } from "./invariants/driftPlan.test"
import { tests as zeroLegacyEnvTests } from "./invariants/zeroLegacyEnv.test"
import { tests as environmentTemplatesTests } from "./unit/environmentTemplates.test"
import { tests as environmentTemplatesRouteTests } from "./api/environmentTemplatesRoute.test"
import { tests as requestTemplatesRouteTests } from "./api/requestTemplatesRoute.test"
import { tests as requestTemplatesTests } from "./unit/requestTemplates.test"
import { tests as moduleRegistryTests } from "./unit/moduleRegistry.test"
import { tests as envSkeletonTests } from "./unit/envSkeleton.test"
import { tests as isEnvironmentDeployedTests } from "./unit/isEnvironmentDeployed.test"
import { tests as createDeployPRTests } from "./unit/createDeployPR.test"
import { tests as getEnvironmentDeployStatusTests } from "./unit/getEnvironmentDeployStatus.test"
import { tests as environmentsCreateTests } from "./invariants/environmentsCreate.test"
import { tests as environmentDeployRouteTests } from "./api/environmentDeployRoute.test"
import { tests as environmentsCreateRouteTests } from "./api/environmentsCreateRoute.test"
import { tests as environmentDeployErrorsRouteTests } from "./api/environmentDeployErrorsRoute.test"
import { tests as environmentActivityRouteTests } from "./api/environmentActivityRoute.test"
import { tests as deployErrorsTests } from "./invariants/deployErrors.test"
import { tests as environmentActivityTests } from "./unit/environmentActivity.test"
import { tests as envTemplatesStoreTests } from "./unit/envTemplatesStore.test"
import { tests as envTemplatesValidationTests } from "./unit/envTemplatesValidation.test"
import { tests as envTemplatesAdminRouteTests } from "./api/envTemplatesAdminRoute.test"
import { tests as validateTemplateIdOrThrowTests } from "./unit/validateTemplateIdOrThrow.test"
import { tests as projectAccessTests } from "./unit/projectAccess.test"
import { tests as projectAccessEnforcementTests } from "./unit/projectAccessEnforcement.test"
import { tests as projectAccessEnforcementRouteTests } from "./api/projectAccessEnforcementRoute.test"
import { tests as orgLifecycleTests } from "./unit/orgLifecycle.test"
import { tests as orgLifecycleRouteTests } from "./api/orgLifecycleRoute.test"
import { tests as webhookRouteTests } from "./api/webhookRoute.test"
import { tests as idempotencyTests } from "./unit/idempotency.test"
import { tests as indexerTests } from "./unit/indexer.test"
import { tests as requestsListRouteTests } from "./api/requestsListRoute.test"
import { tests as requestsSyncRouteTests } from "./api/requestsSyncRoute.test"

const allSuites = [
  reconcileTests,
  completionTimeTests,
  auditDeterminismTests,
  locksTests,
  environmentsHelpersTests,
  rendererModel2Tests,
  requestEnvironmentTests,
  envDestroyTests,
  envFieldsChunk9Tests,
  model2LegacyTests,
  driftPlanTests,
  zeroLegacyEnvTests,
  environmentTemplatesTests,
  environmentTemplatesRouteTests,
  requestTemplatesRouteTests,
  requestTemplatesTests,
  moduleRegistryTests,
  envSkeletonTests,
  isEnvironmentDeployedTests,
  createDeployPRTests,
  getEnvironmentDeployStatusTests,
  environmentsCreateTests,
  environmentDeployRouteTests,
  environmentsCreateRouteTests,
  environmentDeployErrorsRouteTests,
  environmentActivityRouteTests,
  deployErrorsTests,
  environmentActivityTests,
  envTemplatesStoreTests,
  envTemplatesValidationTests,
  envTemplatesAdminRouteTests,
  validateTemplateIdOrThrowTests,
  projectAccessTests,
  projectAccessEnforcementTests,
  projectAccessEnforcementRouteTests,
  orgLifecycleTests,
  orgLifecycleRouteTests,
  webhookRouteTests,
  idempotencyTests,
  indexerTests,
  requestsListRouteTests,
  requestsSyncRouteTests,
]

let passed = 0
let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<boolean> {
  try {
    const result = fn()
    if (result instanceof Promise) await result
    console.log(`  ✓ ${name}`)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`  ✗ ${name}`)
    console.error(`    ${message}`)
    return false
  }
}

;(async () => {
  for (const tests of allSuites) {
    for (const { name, fn } of tests) {
      const ok = await runTest(name, fn)
      if (ok) passed++
      else failed++
    }
  }

  console.log("")
  console.log(`${passed} passed, ${failed} failed`)

  if (failed > 0) {
    process.exit(1)
  }
})()
