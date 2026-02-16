import { NextResponse, type NextRequest } from "next/server"

import { decodeSessionToken } from "@/lib/auth/session"

const SESSION_COOKIE = "tfplan_session"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth",
  "/_next",
  "/favicon.ico",
  "/tfplan-stack.yaml",
  "/api/health",
]

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = token ? decodeSessionToken(token) : null
  const hasSession = Boolean(session)

  if (!hasSession) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  // For root path, redirect authenticated users to /requests (client will handle AWS connection check)
  if (pathname === "/") {
    const url = req.nextUrl.clone()
    url.pathname = "/requests"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\.).*)"],
}
