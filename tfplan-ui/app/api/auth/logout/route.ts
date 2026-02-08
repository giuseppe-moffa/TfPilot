import { NextResponse } from "next/server"

import { clearSession } from "@/lib/auth/session"

export function POST() {
  const res = NextResponse.json({ ok: true })
  clearSession(res)
  return res
}
