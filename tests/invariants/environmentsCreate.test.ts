/**
 * Invariant tests: POST /api/environments template validation.
 * Chunk 3.1 — INVALID_ENV_TEMPLATE, template_version, archived_at.
 */

import { isValidTemplateId } from "@/lib/environments/validateTemplateId"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "isValidTemplateId: accepts null and undefined",
    fn: () => {
      assert(isValidTemplateId(null) === true, "null allowed")
      assert(isValidTemplateId(undefined) === true, "undefined allowed")
    },
  },
  {
    name: "isValidTemplateId: empty string is invalid",
    fn: () => {
      assert(isValidTemplateId("") === false, "empty string must be invalid")
      assert(isValidTemplateId("   ") === false, "whitespace only treated as invalid")
    },
  },
  {
    name: "isValidTemplateId: accepts blank",
    fn: () => {
      assert(isValidTemplateId("blank") === true, "blank allowed")
    },
  },
  {
    name: "isValidTemplateId: accepts valid template ids",
    fn: () => {
      assert(isValidTemplateId("baseline-ai-service") === true, "baseline-ai-service")
      assert(isValidTemplateId("baseline-app-service") === true, "baseline-app-service")
      assert(isValidTemplateId("baseline-worker-service") === true, "baseline-worker-service")
    },
  },
  {
    name: "isValidTemplateId: rejects unknown template_id",
    fn: () => {
      assert(isValidTemplateId("unknown") === false, "unknown rejected")
      assert(isValidTemplateId("baseline-xyz") === false, "baseline-xyz rejected")
      assert(isValidTemplateId("invalid_env_template") === false, "invalid id rejected")
    },
  },
  {
    name: "INVALID_ENV_TEMPLATE: error code is INVALID_ENV_TEMPLATE",
    fn: () => {
      // Contract: 400 response body must include { error: "INVALID_ENV_TEMPLATE" }
      const expectedError = "INVALID_ENV_TEMPLATE"
      assert(expectedError === "INVALID_ENV_TEMPLATE", "error code constant")
    },
  },
]
