/**
 * Validates that server-authoritative tag helpers behave correctly: required tags
 * are present after injection, and assertRequiredTagsPresent accepts valid config.
 * Run: npx tsx scripts/validate-server-tags.ts
 */
import {
  buildServerAuthoritativeTags,
  injectServerAuthoritativeTags,
  assertRequiredTagsPresent,
  REQUIRED_TAG_KEYS,
} from "../lib/requests/tags"

const request = { id: "req-1", project: "p1", environment: "dev" }
const requestWithTemplate = { ...request, templateId: "dev-compute" }
const createdBy = "test-user"

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message)
  }
}

// Build required tags
const tags = buildServerAuthoritativeTags(request, createdBy)
for (const key of REQUIRED_TAG_KEYS) {
  assert(tags[key] !== undefined && String(tags[key]).trim() !== "", `Missing ${key}`)
}
assert(tags["tfpilot:request_id"] === "req-1", "request_id value")
assert(tags["tfpilot:created_by"] === "test-user", "created_by value")

// With template_id
const tagsWithTemplate = buildServerAuthoritativeTags(requestWithTemplate, createdBy)
assert(tagsWithTemplate["tfpilot:template_id"] === "dev-compute", "template_id when present")

// Inject into config (required overwrite user)
const config: Record<string, unknown> = { name: "test", tags: { "user:key": "user-val" } }
injectServerAuthoritativeTags(config, request, createdBy)
const mergedTags = config.tags as Record<string, string>
assert(mergedTags["user:key"] === "user-val", "Extra user tag preserved")
assert(mergedTags["tfpilot:request_id"] === "req-1", "Required overwrite")
assertRequiredTagsPresent(config, request)

// Assertion fails when required tag missing
const badConfig = { tags: { "tfpilot:project": "p1" } }
let threw = false
try {
  assertRequiredTagsPresent(badConfig, request)
} catch {
  threw = true
}
assert(threw, "assertRequiredTagsPresent must throw when required keys missing")

console.log("Server-authoritative tags validation passed.")
process.exit(0)
