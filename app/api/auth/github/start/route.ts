import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "node:crypto"

import { clearStateCookie, setStateCookie } from "@/lib/auth/session"

function buildRedirectUri(req: NextRequest) {
  // ALWAYS use the hardcoded public domain to avoid any hostname issues
  // The environment variable should be set, but we'll use a hardcoded fallback
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect && envRedirect.includes('tfpilot.com')) {
    console.log('[auth/github/start] Using GITHUB_OAUTH_REDIRECT:', envRedirect)
    return envRedirect
  }
  
  // Always use the public domain - never trust the Host header in production
  const publicDomain = 'tfpilot.com'
  const uri = `https://${publicDomain}/api/auth/github/callback`
  console.log('[auth/github/start] Using hardcoded public domain:', uri)
  console.log('[auth/github/start] Host header was:', req.headers.get('host'))
  console.log('[auth/github/start] GITHUB_OAUTH_REDIRECT env var:', envRedirect || 'NOT_SET')
  return uri
}

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: "Missing GitHub client configuration" }, { status: 500 })
  }

  const state = randomBytes(16).toString("base64url")
  const redirectUri = buildRedirectUri(req)
  console.log('[auth/github/start] Final redirect URI being sent to GitHub:', redirectUri)
  const scope = ["read:user", "repo"].join(" ")

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  })

  const url = `https://github.com/login/oauth/authorize?${params.toString()}`
  console.log('[auth/github/start] Redirecting to GitHub OAuth with redirect_uri:', redirectUri)
  const res = NextResponse.redirect(url)
  setStateCookie(res, state)
  // clear any stale session state cookie first to avoid buildup
  clearStateCookie(res)
  setStateCookie(res, state)
  return res
}
