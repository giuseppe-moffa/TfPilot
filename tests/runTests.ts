/**
 * Minimal test runner. Executes all tests (invariants, unit, API routes);
 * exits non-zero if any test throws.
 * Run: npm run test
 */

import { tests as reconcileTests } from "./invariants/reconcile.test"
import { tests as completionTimeTests } from "./invariants/completionTime.test"
import { tests as auditDeterminismTests } from "./invariants/auditDeterminism.test"
import { tests as locksTests } from "./invariants/locks.test"
import { tests as rendererModel2Tests } from "./invariants/rendererModel2.test"
import { tests as requestEnvironmentTests } from "./invariants/requestEnvironment.test"
import { tests as envDestroyTests } from "./invariants/envDestroy.test"
import { tests as envFieldsChunk9Tests } from "./invariants/envFieldsChunk9.test"
import { tests as model2LegacyTests } from "./invariants/model2Legacy.test"
import { tests as driftPlanTests } from "./invariants/driftPlan.test"
import { tests as zeroLegacyEnvTests } from "./invariants/zeroLegacyEnv.test"
import { tests as requestTemplatesRouteTests } from "./api/requestTemplatesRoute.test"
import { tests as requestTemplatesTests } from "./unit/requestTemplates.test"
import { tests as moduleRegistryTests } from "./unit/moduleRegistry.test"
import { tests as createDeployPRTests } from "./unit/createDeployPR.test"
import { tests as deployErrorsTests } from "./invariants/deployErrors.test"
import { tests as workspaceActivityTests } from "./unit/workspaceActivity.test"
import { tests as validateTemplateIdOrThrowTests } from "./unit/validateTemplateIdOrThrow.test"
import { tests as projectAccessEnforcementTests } from "./unit/projectAccessEnforcement.test"
import { tests as projectAccessEnforcementRouteTests } from "./api/projectAccessEnforcementRoute.test"
import { tests as orgLifecycleTests } from "./unit/orgLifecycle.test"
import { tests as orgLifecycleRouteTests } from "./api/orgLifecycleRoute.test"
import { tests as webhookRouteTests } from "./api/webhookRoute.test"
import { tests as idempotencyTests } from "./unit/idempotency.test"
import { tests as indexerTests } from "./unit/indexer.test"
import { tests as requestsListRouteTests } from "./api/requestsListRoute.test"
import { tests as requestsSyncRouteTests } from "./api/requestsSyncRoute.test"
import { tests as auditRouteTests } from "./api/auditRoute.test"
import { tests as projectRoleManagementRouteTests } from "./api/projectRoleManagementRoute.test"
import { tests as requestActionRouteTests } from "./api/requestActionRoute.test"
import { tests as teamMemberAuditProducerTests } from "./unit/teamMemberAuditProducer.test"
import { tests as projectRolesTests } from "./unit/projectRoles.test"
import { tests as permissionsTests } from "./unit/permissions.test"
const allSuites = [
  reconcileTests,
  completionTimeTests,
  auditDeterminismTests,
  locksTests,
  rendererModel2Tests,
  requestEnvironmentTests,
  envDestroyTests,
  envFieldsChunk9Tests,
  model2LegacyTests,
  driftPlanTests,
  zeroLegacyEnvTests,
  requestTemplatesRouteTests,
  requestTemplatesTests,
  moduleRegistryTests,
  createDeployPRTests,
  deployErrorsTests,
  workspaceActivityTests,
  validateTemplateIdOrThrowTests,
  projectAccessEnforcementTests,
  projectAccessEnforcementRouteTests,
  orgLifecycleTests,
  orgLifecycleRouteTests,
  webhookRouteTests,
  idempotencyTests,
  indexerTests,
  requestsListRouteTests,
  requestsSyncRouteTests,
  auditRouteTests,
  projectRoleManagementRouteTests,
  requestActionRouteTests,
  teamMemberAuditProducerTests,
  projectRolesTests,
  permissionsTests,
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
