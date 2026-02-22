import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { env } from "@/lib/config/env"

const s3 = new S3Client({ region: env.TFPILOT_DEFAULT_REGION })
const BUCKET = env.TFPILOT_REQUESTS_BUCKET
const COST_PREFIX = "cost/"

export type RequestCost = {
  monthlyCost?: number
  diffSummary?: string
  lastUpdated?: string
}

async function streamToString(stream: any): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk: Buffer) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

function parseCostNumber(value: unknown): number | undefined {
  if (typeof value === "number" && !Number.isNaN(value)) return value
  if (typeof value === "string") {
    const n = parseFloat(value.replace(/[^0-9.-]/g, ""))
    return Number.isNaN(n) ? undefined : n
  }
  return undefined
}

/** Infracost JSON can have totalMonthlyCost at root or under projects[0]. */
function getTotalMonthlyCost(obj: Record<string, unknown>): string | number | undefined {
  const atRoot = obj.totalMonthlyCost
  if (atRoot !== undefined && atRoot !== null) return atRoot as string | number
  const projects = obj.projects as Array<Record<string, unknown>> | undefined
  const first = projects?.[0]
  return first?.totalMonthlyCost as string | number | undefined
}

function getPastTotalMonthlyCost(obj: Record<string, unknown>): string | number | undefined {
  const atRoot = obj.pastTotalMonthlyCost
  if (atRoot !== undefined && atRoot !== null) return atRoot as string | number
  const projects = obj.projects as Array<Record<string, unknown>> | undefined
  const first = projects?.[0]
  return first?.pastTotalMonthlyCost as string | number | undefined
}

function getDiffTotalMonthlyCost(obj: Record<string, unknown>): string | number | undefined {
  const atRoot = obj.diffTotalMonthlyCost
  if (atRoot !== undefined && atRoot !== null) return atRoot as string | number
  const projects = obj.projects as Array<Record<string, unknown>> | undefined
  const first = projects?.[0]
  return first?.diffTotalMonthlyCost as string | number | undefined
}

/**
 * Fetch cost estimation data from S3 for a request.
 * Reads infracost-cost.json and infracost-diff.json from cost/<requestId>/.
 * Returns a normalized summary; if files are missing, returns null (no error).
 */
export async function getRequestCost(requestId: string): Promise<RequestCost | null> {
  if (!requestId?.trim()) return null

  const costKey = `${COST_PREFIX}${requestId}/infracost-cost.json`
  const diffKey = `${COST_PREFIX}${requestId}/infracost-diff.json`

  let monthlyCost: number | undefined
  let diffSummary: string | undefined
  let lastUpdated: string | undefined

  try {
    const [costRes, diffRes] = await Promise.allSettled([
      s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: costKey })),
      s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: diffKey })),
    ])

    if (costRes.status === "rejected" && process.env.NODE_ENV !== "production") {
      console.warn("[cost-service] S3 GetObject cost failed:", costRes.reason?.message ?? costRes.reason)
    }
    if (diffRes.status === "rejected" && process.env.NODE_ENV !== "production") {
      console.warn("[cost-service] S3 GetObject diff failed:", diffRes.reason?.message ?? diffRes.reason)
    }

    if (costRes.status === "fulfilled" && costRes.value.Body) {
      const costJson = JSON.parse(await streamToString(costRes.value.Body as any)) as Record<string, unknown>
      monthlyCost = parseCostNumber(getTotalMonthlyCost(costJson))
      if (costRes.value.LastModified) {
        lastUpdated = costRes.value.LastModified.toISOString()
      }
    }

    if (diffRes.status === "fulfilled" && diffRes.value.Body) {
      const diffJson = JSON.parse(await streamToString(diffRes.value.Body as any)) as Record<string, unknown>
      const total = parseCostNumber(getTotalMonthlyCost(diffJson))
      const past = parseCostNumber(getPastTotalMonthlyCost(diffJson))
      const diff = parseCostNumber(getDiffTotalMonthlyCost(diffJson))
      if (total !== undefined || past !== undefined || diff !== undefined) {
        const parts: string[] = []
        if (total !== undefined) parts.push(`Monthly: $${total.toFixed(2)}`)
        if (past !== undefined) parts.push(`Previous: $${past.toFixed(2)}`)
        if (diff !== undefined) {
          const sign = diff >= 0 ? "+" : ""
          parts.push(`Diff: ${sign}$${diff.toFixed(2)}`)
        }
        diffSummary = parts.join(" · ")
      }
      if (diffRes.value.LastModified && !lastUpdated) {
        lastUpdated = diffRes.value.LastModified.toISOString()
      }
    }

    if (monthlyCost === undefined && !diffSummary) return null

    return {
      ...(monthlyCost !== undefined && { monthlyCost }),
      ...(diffSummary && { diffSummary }),
      ...(lastUpdated && { lastUpdated }),
    }
  } catch {
    return null
  }
}
