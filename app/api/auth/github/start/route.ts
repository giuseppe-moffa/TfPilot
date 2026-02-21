import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "node:crypto"

import { clearStateCookie, setStateCookie } from "@/lib/auth/session"

function buildRedirectUri(req: NextRequest) {
  // Use env so local dev can set http://localhost:3000/... and prod can set https://tfpilot.com/...
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) {
    console.log('[auth/github/start] Using GITHUB_OAUTH_REDIRECT:', envRedirect)
    return envRedirect
  }
  // Fallback: public domain (never trust Host header in production)
  const publicDomain = 'tfpilot.com'
  const uri = `https://${publicDomain}/api/auth/github/callback`
  console.log('[auth/github/start] Using hardcoded public domain:', uri)
  console.log('[auth/github/start] GITHUB_OAUTH_REDIRECT env var: NOT_SET')
  return uri
}

export async function GET(req: NextRequest) {
  console.log('[auth/github/start] ===== OAuth Start Request =====')
  console.log('[auth/github/start] Request URL:', req.url)
  console.log('[auth/github/start] Request origin:', req.nextUrl.origin)
  console.log('[auth/github/start] Host header:', req.headers.get('host'))
  console.log('[auth/github/start] X-Forwarded-Host:', req.headers.get('x-forwarded-host'))
  console.log('[auth/github/start] X-Forwarded-Proto:', req.headers.get('x-forwarded-proto'))
  
  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    console.error('[auth/github/start] ERROR: Missing GITHUB_CLIENT_ID')
    return NextResponse.json({ error: "Missing GitHub client configuration" }, { status: 500 })
  }
  console.log('[auth/github/start] GITHUB_CLIENT_ID:', clientId ? 'SET' : 'NOT_SET')

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
  console.log('[auth/github/start] Full GitHub OAuth URL:', url.replace(clientId, 'CLIENT_ID_REDACTED'))
  console.log('[auth/github/start] Redirect URI in params:', redirectUri)
  console.log('[auth/github/start] State:', state)
  console.log('[auth/github/start] ===== Redirecting to GitHub =====')
  
  const res = NextResponse.redirect(url)
  setStateCookie(res, state)
  // clear any stale session state cookie first to avoid buildup
  clearStateCookie(res)
  setStateCookie(res, state)
  return res
}
