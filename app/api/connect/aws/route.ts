import { NextRequest, NextResponse } from "next/server"
import {
  STSClient,
  GetCallerIdentityCommand,
  AssumeRoleCommand,
  Credentials as StsCredentials,
} from "@aws-sdk/client-sts"

import { getSessionFromCookies } from "@/lib/auth/session"

type RequestBody =
  | {
      accessKeyId: string
      secretAccessKey: string
      region: string
      assumeRoleArn?: string
    }
  | {
      assumeRoleArn: string
      region: string
      accessKeyId?: string
      secretAccessKey?: string
    }

function createBaseClient(body: RequestBody) {
  const baseConfig: ConstructorParameters<typeof STSClient>[0] = {
    region: body.region,
  }

  if ("accessKeyId" in body && body.accessKeyId && body.secretAccessKey) {
    baseConfig.credentials = {
      accessKeyId: body.accessKeyId,
      secretAccessKey: body.secretAccessKey,
    }
  }

  return new STSClient(baseConfig)
}

async function resolveCredentials(body: RequestBody) {
  // If assumeRoleArn provided, attempt to assume role first.
  if ("assumeRoleArn" in body && body.assumeRoleArn) {
    const baseClient = createBaseClient(body)
    const assumeResp = await baseClient.send(
      new AssumeRoleCommand({
        RoleArn: body.assumeRoleArn,
        RoleSessionName: "tfplan-session",
        DurationSeconds: 3600,
      })
    )
    const creds = assumeResp.Credentials as StsCredentials | undefined
    if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      throw new Error("Invalid assume role response")
    }

    return new STSClient({
      region: body.region,
      credentials: {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
      },
    })
  }

  // Fallback to direct credentials (or default provider chain if none provided)
  return createBaseClient(body)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<RequestBody> | null
    const region = body?.region
    const hasKeys = Boolean(body?.accessKeyId && body?.secretAccessKey)
    const hasRole = Boolean(body?.assumeRoleArn)

    const session = await getSessionFromCookies()
    if (!session) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    }

    if (!region || (!hasKeys && !hasRole)) {
      return NextResponse.json(
        { success: false, error: "Missing credentials or region" },
        { status: 400 }
      )
    }

    const client = await resolveCredentials({
      region,
      accessKeyId: body?.accessKeyId ?? "",
      secretAccessKey: body?.secretAccessKey ?? "",
      assumeRoleArn: body?.assumeRoleArn,
    } as RequestBody)

    const identity = await client.send(new GetCallerIdentityCommand({}))

    if (!identity.Arn || !identity.Account) {
      throw new Error("Invalid credentials")
    }

    const connection = {
      arn: identity.Arn,
      accountId: identity.Account,
      region,
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json({
      success: true,
      identity: connection,
    })
  } catch (error) {
    console.error("[api/connect/aws] error", error)
    return NextResponse.json(
      { success: false, error: "Invalid credentials" },
      { status: 401 }
    )
  }
}

export function GET() {
  return NextResponse.json({ success: false, error: "Method not allowed" }, { status: 405 })
}

export function PUT() {
  return NextResponse.json({ success: false, error: "Method not allowed" }, { status: 405 })
}

export function DELETE() {
  return NextResponse.json({ success: false, error: "Method not allowed" }, { status: 405 })
}
