/**
 * In-memory S3 stub for deterministic tests. No AWS credentials required.
 * Implements GetObject, PutObject, HeadObject, DeleteObject.
 * Records PutObject order for docs-first write-order assertions.
 */

import { Readable } from "node:stream"

export const TEST_BUCKET = "tfpilot-test-bucket"

export function createS3Stub(): {
  send: (cmd: unknown) => Promise<unknown>
  getStore: () => Map<string, string>
  getPutOrder: () => { bucket: string; key: string }[]
  clear: () => void
} {
  const store = new Map<string, string>()
  const putOrder: { bucket: string; key: string }[] = []

  return {
    async send(cmd: unknown): Promise<unknown> {
      const c = cmd as {
        constructor?: { name: string }
        input?: { Bucket?: string; Key?: string; Body?: string | Uint8Array }
        Bucket?: string
        Key?: string
        Body?: string | Uint8Array
      }
      const name = c?.constructor?.name ?? ""
      const input = c?.input ?? c
      const bucket = (input?.Bucket ?? c?.Bucket) ?? ""
      const key = (input?.Key ?? c?.Key) ?? ""

      if (name === "GetObjectCommand") {
        const k = `${bucket}/${key}`
        const val = store.get(k)
        if (!val) {
          const err = new Error("NoSuchKey") as Error & { name: string }
          err.name = "NoSuchKey"
          throw err
        }
        const body = Readable.from([Buffer.from(val, "utf8")])
        return { Body: body }
      }

      if (name === "PutObjectCommand") {
        putOrder.push({ bucket, key })
        const body = input?.Body ?? c?.Body
        const str = typeof body === "string" ? body : body instanceof Uint8Array ? new TextDecoder().decode(body) : ""
        store.set(`${bucket}/${key}`, str)
        return {}
      }

      if (name === "HeadObjectCommand") {
        const k = `${bucket}/${key}`
        if (!store.has(k)) {
          const err = new Error("NoSuchKey") as Error & { name: string }
          err.name = "NoSuchKey"
          throw err
        }
        return {}
      }

      if (name === "DeleteObjectCommand") {
        store.delete(`${bucket}/${key}`)
        return {}
      }

      throw new Error(`S3 stub: unsupported command ${name}`)
    },
    getStore: () => store,
    getPutOrder: () => [...putOrder],
    clear: () => {
      store.clear()
      putOrder.length = 0
    },
  }
}
