import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "node:crypto"

import { clearStateCookie, setStateCookie } from "@/lib/auth/session"

/** Expected callback URL for production (must match GitHub app / OAuth app settings). */
const EXPECTED_PROD_CALLBACK = "https://tfpilot.com/api/auth/github/callback"

/** Required OAuth scopes for TfPilot (profile + repo write). */
const REQUIRED_SCOPE = "read:user user:email repo"

function buildRedirectUri(_req: NextRequest) {
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

  const state = randomBytes(16).toString("base64url")
  const redirectUri = buildRedirectUri(req)
  const scope = REQUIRED_SCOPE

  // In production (callback points to tfpilot.com), require exact match to avoid redirect_uri mismatch
  const isProdCallback = redirectUri.startsWith("https://tfpilot.com/")
  if (isProdCallback && redirectUri !== EXPECTED_PROD_CALLBACK) {
    console.error('[auth/github/start] REDIRECT_URI_MISMATCH:', {
      expected: EXPECTED_PROD_CALLBACK,
      actual: redirectUri,
    })
    return NextResponse.json(
      {
        error: "OAuth callback URL mismatch",
        detail: `Production redirect_uri must be exactly "${EXPECTED_PROD_CALLBACK}". Got: "${redirectUri}". Set GITHUB_OAUTH_REDIRECT in the environment and ensure the same URL is registered in GitHub (OAuth App or GitHub App → User authorization callback URL).`,
      },
      { status: 500 }
    )
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope,
  })
  const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`

  // Single structured log for prod debugging (client_id redacted)
  console.log('[auth/github/start] AUTHORIZE_URL_DEBUG', JSON.stringify({
    client_id: clientId ? `${clientId.slice(0, 8)}...` : 'MISSING',
    redirect_uri: redirectUri,
    scope,
    expected_prod_callback: EXPECTED_PROD_CALLBACK,
    redirect_uri_ok: !isProdCallback || redirectUri === EXPECTED_PROD_CALLBACK,
  }))
  console.log('[auth/github/start] Full authorize URL (client_id redacted):', authorizeUrl.replace(clientId, 'CLIENT_ID_REDACTED'))

  const res = NextResponse.redirect(authorizeUrl)
  clearStateCookie(res)
  setStateCookie(res, state)
  return res
}
