/**
 * Route-level tests: POST /api/github/webhook.
 * Uses makeWebhookPOST() with injected mocks; no real GitHub, S3, or storage.
 */

import { NextRequest } from "next/server"
import { makeWebhookPOST, type WebhookRouteDeps } from "@/app/api/github/webhook/route"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function webhookRequest(opts: {
  body?: string
  signature?: string
  deliveryId?: string
  event?: string
}): NextRequest {
  const { body = "{}", signature = "sha256=valid", deliveryId = "delivery-123", event = "ping" } = opts
  return new NextRequest("http://localhost/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-delivery": deliveryId,
      "x-github-event": event,
    },
  })
}

async function callWebhook(deps: WebhookRouteDeps, req: NextRequest): Promise<Response> {
  const POST = makeWebhookPOST(deps)
  const res = await POST(req)
  return res as unknown as Response
}

export const tests = [
  {
    name: "webhook: invalid signature returns 401",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => false,
        hasDelivery: async () => false,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({}),
        updateRequest: async () => [undefined, false],
        appendStreamEvent: async () => {},
      }
      const req = webhookRequest({ body: "{}", deliveryId: "d1", event: "ping" })
      const res = await callWebhook(deps, req)
      assert(res.status === 401, `expected 401, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "Invalid signature", `expected error, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 0, "recordDelivery must NOT be called on invalid signature")
    },
  },
  {
    name: "webhook: missing delivery id returns 400",
    fn: async () => {
      const req = new NextRequest("http://localhost/api/github/webhook", {
        method: "POST",
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=valid",
          "x-github-event": "ping",
          // no x-github-delivery
        },
      })
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => false,
        recordDelivery: async () => {},
        getSecret: () => "secret",
        correlatePullRequest: async () => ({}),
        updateRequest: async () => [undefined, false],
        appendStreamEvent: async () => {},
      }
      const res = await callWebhook(deps, req)
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "Missing X-GitHub-Delivery", `expected error, got ${JSON.stringify(body)}`)
    },
  },
  {
    name: "webhook: duplicate delivery returns success-style duplicate response, does NOT re-process",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const updateRequestCalls: string[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => true,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({ requestId: "req_1" }),
        updateRequest: async (id) => {
          updateRequestCalls.push(id)
          return [undefined, true]
        },
        appendStreamEvent: async () => {},
      }
      const req = webhookRequest({
        body: JSON.stringify({
          pull_request: { head: { ref: "refs/heads/request/req_1" } },
          repository: { full_name: "owner/repo" },
        }),
        deliveryId: "dup-1",
        event: "pull_request",
      })
      const res = await callWebhook(deps, req)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body?.duplicate === true, `expected duplicate: true, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 0, "recordDelivery must NOT be called for duplicate")
      assert(updateRequestCalls.length === 0, "updateRequest must NOT be called for duplicate")
    },
  },
  {
    name: "webhook: valid pull_request event processes, records delivery, invokes correlation/patch once",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const updateRequestCalls: string[] = []
      const appendStreamCalls: { requestId: string; type: string }[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => false,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({ requestId: "req_test_123" }),
        updateRequest: async (id, updater) => {
          updateRequestCalls.push(id)
          const current = { id, runs: {} }
          const patched = updater(current)
          return [patched, true]
        },
        appendStreamEvent: async (ev) => {
          appendStreamCalls.push({ requestId: ev.requestId, type: ev.type })
        },
      }
      const req = webhookRequest({
        body: JSON.stringify({
          pull_request: { number: 1, head: { ref: "refs/heads/request/req_test_123" } },
          repository: { full_name: "owner/repo" },
        }),
        deliveryId: "new-1",
        event: "pull_request",
      })
      const res = await callWebhook(deps, req)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body?.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 1, `recordDelivery must be called once, got ${recordDeliveryCalls.length}`)
      assert(recordDeliveryCalls[0]?.deliveryId === "new-1", "recordDelivery with correct deliveryId")
      assert(recordDeliveryCalls[0]?.event === "pull_request", "recordDelivery with correct event")
      assert(updateRequestCalls.length === 1, `updateRequest must be called once, got ${updateRequestCalls.length}`)
      assert(updateRequestCalls[0] === "req_test_123", "updateRequest with correct requestId")
      assert(appendStreamCalls.length === 1, `appendStreamEvent must be called once, got ${appendStreamCalls.length}`)
      assert(appendStreamCalls[0]?.requestId === "req_test_123", "appendStreamEvent with correct requestId")
    },
  },
  {
    name: "webhook: unknown event handled safely, records delivery, returns 200",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => false,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({}),
        updateRequest: async () => [undefined, false],
        appendStreamEvent: async () => {},
      }
      const req = webhookRequest({
        body: JSON.stringify({ zen: "Design is not just what it looks like." }),
        deliveryId: "ping-1",
        event: "ping",
      })
      const res = await callWebhook(deps, req)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body?.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 1, `recordDelivery must be called once, got ${recordDeliveryCalls.length}`)
      assert(recordDeliveryCalls[0]?.event === "ping", "recordDelivery with correct event")
    },
  },
  {
    name: "webhook: invalid JSON body returns 400",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => false,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({}),
        updateRequest: async () => [undefined, false],
        appendStreamEvent: async () => {},
      }
      const req = webhookRequest({
        body: "not valid json {{{",
        deliveryId: "bad-1",
        event: "ping",
      })
      const res = await callWebhook(deps, req)
      assert(res.status === 400, `expected 400, got ${res.status}`)
      const body = await res.json()
      assert(body?.error === "Invalid JSON body", `expected error, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 0, "recordDelivery must NOT be called on invalid JSON")
    },
  },
  {
    name: "webhook: workflow_run with unknown kind records delivery, no mutation calls",
    fn: async () => {
      const recordDeliveryCalls: { deliveryId: string; event: string }[] = []
      const updateRequestCalls: string[] = []
      const deps: WebhookRouteDeps = {
        verifySignature: () => true,
        hasDelivery: async () => false,
        recordDelivery: async (id, ev) => {
          recordDeliveryCalls.push({ deliveryId: id, event: ev })
        },
        getSecret: () => "secret",
        correlatePullRequest: async () => ({}),
        updateRequest: async (id) => {
          updateRequestCalls.push(id)
          return [undefined, false]
        },
        appendStreamEvent: async () => {},
      }
      const req = webhookRequest({
        body: JSON.stringify({
          workflow_run: {
            name: "SomeRandomWorkflow",
            display_title: "x",
          },
        }),
        deliveryId: "wr-unknown-1",
        event: "workflow_run",
      })
      const res = await callWebhook(deps, req)
      assert(res.status === 200, `expected 200, got ${res.status}`)
      const body = await res.json()
      assert(body?.ok === true, `expected ok: true, got ${JSON.stringify(body)}`)
      assert(recordDeliveryCalls.length === 1, `recordDelivery must be called once, got ${recordDeliveryCalls.length}`)
      assert(updateRequestCalls.length === 0, "updateRequest must NOT be called for unknown workflow_run")
    },
  },
]
