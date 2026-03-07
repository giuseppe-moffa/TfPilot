/**
 * Unit tests: org lifecycle (requireActiveOrg, ARCHIVED_ORG_ERROR).
 * No DB required for these cases. Full archive/restore behavior covered by API route tests.
 */

import { requireActiveOrg, ARCHIVED_ORG_ERROR } from "@/lib/auth/requireActiveOrg"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

export const tests = [
  {
    name: "requireActiveOrg: null session returns null (proceed)",
    fn: async () => {
      const res = await requireActiveOrg(null)
      assert(res === null, `expected null, got ${res}`)
    },
  },
  {
    name: "requireActiveOrg: session without orgId returns null (proceed)",
    fn: async () => {
      const res = await requireActiveOrg({
        login: "user1",
        name: "User",
        avatarUrl: null,
      })
      assert(res === null, `expected null, got ${res}`)
    },
  },
  {
    name: "requireActiveOrg: session with orgId when DB not configured returns null (isOrgArchived false)",
    fn: async () => {
      // When DATABASE_URL is not set, isOrgArchived returns false
      const res = await requireActiveOrg({
        login: "user1",
        name: "User",
        avatarUrl: null,
        orgId: "org_any",
        orgSlug: "any",
      })
      assert(res === null, `expected null when org not archived, got ${res}`)
    },
  },
  {
    name: "ARCHIVED_ORG_ERROR constant is correct",
    fn: () => {
      assert(ARCHIVED_ORG_ERROR === "Organization archived", `expected "Organization archived"`)
    },
  },
]
