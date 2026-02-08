import { NextResponse, type NextRequest } from "next/server"

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isPublic(pathname)) {
    return NextResponse.next()
  }

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value)

  if (!hasSession) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return NextResponse.redirect(url)
  }

  if (pathname === "/") {
    const url = req.nextUrl.clone()
    url.pathname = "/aws/connect"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!.*\\.).*)"],
}
