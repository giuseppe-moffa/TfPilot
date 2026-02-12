import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"

export async function GET() {
  const session = await getSessionFromCookies()
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }
  return NextResponse.json({ authenticated: true, user: session })
}
