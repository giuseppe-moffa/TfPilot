import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import { env } from "@/lib/config/env"
import { effectiveName } from "@/lib/requests/naming"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  }

  return NextResponse.json({
    success: true,
    policy: {
      nameRegex: "^[a-zA-Z0-9-]{3,63}$",
      allowedRegions: env.TFPILOT_ALLOWED_REGIONS,
      nameExample: effectiveName("example", "req_example_ABC123"),
      nameTemplate: "<base>-<shortId>",
    },
  })
}
