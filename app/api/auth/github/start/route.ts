import { NextResponse, type NextRequest } from "next/server"
import { randomBytes } from "node:crypto"

import { clearStateCookie, setStateCookie } from "@/lib/auth/session"

function buildRedirectUri(req: NextRequest) {
  // Always prefer the environment variable if set
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) {
    console.log('[auth/github/start] Using GITHUB_OAUTH_REDIRECT:', envRedirect)
    return envRedirect
  }
  
  // Fallback: use the Host header (which should be the public domain via ALB)
  const host = req.headers.get('host')
  console.log('[auth/github/start] Host header:', host)
  
  if (host && !host.includes('compute.internal') && !host.includes('localhost')) {
    // Use https for production
    const uri = `https://${host}/api/auth/github/callback`
    console.log('[auth/github/start] Using Host header:', uri)
    return uri
  }
  
  // If Host header is internal/localhost, use the hardcoded public domain
  const publicDomain = 'tfpilot.com'
  const uri = `https://${publicDomain}/api/auth/github/callback`
  console.log('[auth/github/start] Using fallback domain:', uri)
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
