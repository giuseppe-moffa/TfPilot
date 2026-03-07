/**
 * Producer behavior tests: team_member_added audit emits only when insert occurs.
 * Uses makeMembersPOST() with injected mocks.
 */

import { NextRequest } from "next/server"
import { makeMembersPOST, type MembersRouteDeps } from "@/app/api/org/teams/[teamId]/members/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const mockSession = { login: "admin", name: "Admin", avatarUrl: null, orgId: "org_1" }
const mockTeam = { id: "team_1", orgId: "org_1", slug: "eng" }

function defaultDeps(overrides: Partial<MembersRouteDeps> = {}): MembersRouteDeps {
  return {
    getSessionFromCookies: async () => mockSession,
    requireActiveOrg: async () => null,
    getUserOrgRole: async () => "admin",
    getTeamById: async () => mockTeam,
    addTeamMember: async () => true,
    removeTeamMember: async () => false,
    writeAuditEvent: async () => undefined,
    ...overrides,
  }
}

async function callAddMember(
  deps: MembersRouteDeps,
  teamId: string,
  login: string
): Promise<Response> {
  const POST = makeMembersPOST(deps)
  const req = new NextRequest("http://localhost/api/org/teams/team_1/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login }),
  })
  const res = await POST(req, { params: Promise.resolve({ teamId }) })
  return res as unknown as Response
}

export const tests = [
  {
    name: "team_member_added: does NOT emit when addTeamMember returns false (no insert)",
    fn: async () => {
      const auditCalls: unknown[] = []
      const deps = defaultDeps({
        addTeamMember: async () => false,
        writeAuditEvent: async (_, input) => {
          auditCalls.push(input)
        },
      })
      const res = await callAddMember(deps, "team_1", "newuser")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      assert(auditCalls.length === 0, `expected 0 audit calls when insert did not occur, got ${auditCalls.length}`)
    },
  },
  {
    name: "team_member_added: DOES emit when addTeamMember returns true (insert occurred)",
    fn: async () => {
      const auditCalls: unknown[] = []
      const deps = defaultDeps({
        addTeamMember: async () => true,
        writeAuditEvent: async (_, input) => {
          auditCalls.push(input)
        },
      })
      const res = await callAddMember(deps, "team_1", "newuser")
      assert(res.status === 200, `expected 200, got ${res.status}`)
      assert(auditCalls.length === 1, `expected 1 audit call when insert occurred, got ${auditCalls.length}`)
      const evt = auditCalls[0] as { event_type?: string; entity_type?: string; metadata?: { login?: string } }
      assert(evt.event_type === "team_member_added", `expected team_member_added, got ${evt.event_type}`)
      assert(evt.entity_type === "team", `expected entity team, got ${evt.entity_type}`)
      assert(evt.metadata?.login === "newuser", `expected login newuser, got ${evt.metadata?.login}`)
    },
  },
]
