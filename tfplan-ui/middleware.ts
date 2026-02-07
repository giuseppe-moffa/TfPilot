import { NextResponse, type NextRequest } from "next/server"

function hasAwsConnection(req: NextRequest) {
  const flag = req.cookies.get("awsConnected")?.value
  return flag === "true"
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only enforce on the root landing page
  if (pathname === "/") {
    const awsConnected = hasAwsConnection(req)
    const target = awsConnected ? "/requests" : "/aws/connect"

    const url = req.nextUrl.clone()
    url.pathname = target
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/"],
}
