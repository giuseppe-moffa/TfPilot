import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "node:crypto"

import { clearStateCookie, setStateCookie } from "@/lib/auth/session"

function buildRedirectUri(req: NextRequest) {
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) return envRedirect
  const origin = req.nextUrl.origin
  return `${origin}/api/auth/github/callback`
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: "Missing GitHub client configuration" }, { status: 500 })
  }

  const state = randomBytes(16).toString("base64url")
  const redirectUri = buildRedirectUri(req)
  const scope = ["read:user", "repo"].join(" ")

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  })

  const url = `https://github.com/login/oauth/authorize?${params.toString()}`
  const res = NextResponse.redirect(url)
  setStateCookie(res, state)
  // clear any stale session state cookie first to avoid buildup
  clearStateCookie(res)
  setStateCookie(res, state)
  return res
}
