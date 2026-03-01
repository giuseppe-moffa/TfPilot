/**
 * Minimal invariant test runner. Executes all tests from invariant test files;
 * exits non-zero if any test throws.
 * Run: npm run test:invariants
 */

import { tests as reconcileTests } from "./invariants/reconcile.test"
import { tests as completionTimeTests } from "./invariants/completionTime.test"
import { tests as auditDeterminismTests } from "./invariants/auditDeterminism.test"
import { tests as locksTests } from "./invariants/locks.test"

const allSuites = [
  reconcileTests,
  completionTimeTests,
  auditDeterminismTests,
  locksTests,
]

let passed = 0
let failed = 0

for (const tests of allSuites) {
  for (const { name, fn } of tests) {
    try {
      fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ ${name}`)
      console.error(`    ${message}`)
      failed++
    }
  }
}

console.log("")
console.log(`${passed} passed, ${failed} failed`)

if (failed > 0) {
  process.exit(1)
}
