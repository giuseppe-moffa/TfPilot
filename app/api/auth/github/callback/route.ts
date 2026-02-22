import { NextResponse, type NextRequest } from "next/server"

import { clearSession, clearStateCookie, readStateCookie, setSession } from "@/lib/auth/session"
import { env } from "@/lib/config/env"

async function exchangeCodeForToken(code: string, redirectUri: string) {
  console.log('[auth/github/callback] exchangeCodeForToken called')
  console.log('[auth/github/callback] redirectUri parameter:', redirectUri)
  
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[auth/github/callback] Missing client credentials')
    throw new Error("Missing GitHub client configuration")
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })
  
  console.log('[auth/github/callback] Token exchange request body (redacted):', {
    client_id: clientId ? 'SET' : 'NOT_SET',
    client_secret: clientSecret ? 'SET' : 'NOT_SET',
    code: code ? 'SET' : 'NOT_SET',
    redirect_uri: redirectUri,
  })

  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  })

  console.log('[auth/github/callback] Token exchange response status:', resp.status)
  if (!resp.ok) {
    const errorText = await resp.text()
    console.error('[auth/github/callback] Token exchange failed:', errorText)
    throw new Error("GitHub token exchange failed")
  }
  
  const data = (await resp.json()) as { access_token?: string; error?: string; error_description?: string }
  console.log('[auth/github/callback] Token exchange response (redacted):', {
    has_access_token: !!data.access_token,
    error: data.error,
    error_description: data.error_description,
  })
  
  if (!data.access_token) {
    console.error('[auth/github/callback] No access token in response:', data)
    throw new Error(data.error || data.error_description || "Missing access token")
  }
  
  console.log('[auth/github/callback] Token exchange successful')
  return data.access_token
}

async function fetchGithubUser(token: string) {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "TfPilot",
    },
  })
  if (!resp.ok) throw new Error("Failed to fetch GitHub user")
  return (await resp.json()) as { login: string; name: string | null; avatar_url: string | null }
}

function buildRedirectUri(req: NextRequest) {
  // Use env so local dev and prod can each set their callback (must match start route).
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) {
    console.log('[auth/github/callback] Using GITHUB_OAUTH_REDIRECT:', envRedirect)
    return envRedirect
  }
  // Fallback: public domain (never trust Host header in production)
  const publicDomain = 'tfpilot.com'
  const uri = `https://${publicDomain}/api/auth/github/callback`
  console.log('[auth/github/callback] Using hardcoded public domain:', uri)
  return uri
}

export async function GET(req: NextRequest) {
  console.log('[auth/github/callback] ===== OAuth Callback Request =====')
  console.log('[auth/github/callback] Request URL:', req.url)
  console.log('[auth/github/callback] Request origin:', req.nextUrl.origin)
  console.log('[auth/github/callback] Host header:', req.headers.get('host'))
  console.log('[auth/github/callback] X-Forwarded-Host:', req.headers.get('x-forwarded-host'))
  console.log('[auth/github/callback] X-Forwarded-Proto:', req.headers.get('x-forwarded-proto'))
  
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const expectedState = await readStateCookie()

  console.log('[auth/github/callback] Code present:', !!code)
  console.log('[auth/github/callback] Returned state:', returnedState)
  console.log('[auth/github/callback] Expected state:', expectedState)
  console.log('[auth/github/callback] State match:', returnedState === expectedState)

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    console.error('[auth/github/callback] ERROR: State validation failed')
    console.error('[auth/github/callback] Missing code:', !code)
    console.error('[auth/github/callback] Missing returnedState:', !returnedState)
    console.error('[auth/github/callback] Missing expectedState:', !expectedState)
    console.error('[auth/github/callback] State mismatch:', returnedState !== expectedState)
    return NextResponse.redirect(new URL("/login?error=oauth_state", req.url))
  }

  try {
    const redirectUri = buildRedirectUri(req)
    console.log('[auth/github/callback] Using redirect URI for token exchange:', redirectUri)
    console.log('[auth/github/callback] Exchanging code for token...')
    const token = await exchangeCodeForToken(code, redirectUri)
    console.log('[auth/github/callback] Token received, fetching user...')
    const user = await fetchGithubUser(token)
    console.log('[auth/github/callback] User fetched:', user.login)

    if (env.TFPILOT_ALLOWED_LOGINS.length > 0 && !env.TFPILOT_ALLOWED_LOGINS.includes(user.login)) {
      console.warn('[auth/github/callback] Login rejected: user not in TFPILOT_ALLOWED_LOGINS:', user.login)
      return NextResponse.redirect(new URL("/login?error=not_allowed", req.url))
    }

    console.log('[auth/github/callback] Creating session and redirecting to /requests')

    // Redirect back to same origin (localhost for dev, tfpilot.com for prod)
    const baseUrl = process.env.GITHUB_OAUTH_REDIRECT
      ? new URL(process.env.GITHUB_OAUTH_REDIRECT).origin
      : "https://tfpilot.com"
    const redirectUrl = new URL("/requests", baseUrl)
    console.log('[auth/github/callback] Redirecting to:', redirectUrl.toString())
    console.log('[auth/github/callback] Request URL was:', req.url)
    const res = NextResponse.redirect(redirectUrl)
    clearStateCookie(res)
    clearSession(res)
    setSession(res, {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      accessToken: token,
    })
    console.log('[auth/github/callback] ===== OAuth Success =====')
    return res
  } catch (error) {
    console.error("[auth/github/callback] ===== OAuth Error ===== ", error)
    console.error("[auth/github/callback] Error details:", error instanceof Error ? error.message : String(error))
    return NextResponse.redirect(new URL("/login?error=oauth_failed", req.url))
  }
}
