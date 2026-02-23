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

type GithubEmail = { email: string; primary: boolean; verified: boolean; visibility: string | null }
async function fetchGithubUserEmail(token: string): Promise<string | null> {
  const resp = await fetch("https://api.github.com/user/emails", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "TfPilot",
    },
  })
  if (!resp.ok) return null
  const data = (await resp.json()) as GithubEmail[]
  const primary = data.find((e) => e.primary && e.verified)
  if (primary) return primary.email
  const verified = data.find((e) => e.verified)
  return verified?.email ?? data[0]?.email ?? null
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

/** Public base URL for redirects (never use req.url origin behind ALB – it can be internal host). */
function getPublicBaseUrl(): string {
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) return new URL(envRedirect).origin
  return "https://tfpilot.com"
}

/** Build login error URL with optional description for friendly error page. */
function loginErrorUrl(baseUrl: string, error: string, errorDescription?: string | null): string {
  const u = new URL("/login", baseUrl)
  u.searchParams.set("error", error)
  if (errorDescription && errorDescription.trim()) {
    u.searchParams.set("error_description", errorDescription.trim().slice(0, 200))
  }
  return u.toString()
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  // Debug: log all callback query params and request context
  console.log('[auth/github/callback] ===== OAuth Callback Request =====')
  console.log('[auth/github/callback] Request URL:', req.url)
  console.log('[auth/github/callback] Request origin:', req.nextUrl.origin)
  console.log('[auth/github/callback] Host header:', req.headers.get('host'))
  console.log('[auth/github/callback] X-Forwarded-Host:', req.headers.get('x-forwarded-host'))
  console.log('[auth/github/callback] X-Forwarded-Proto:', req.headers.get('x-forwarded-proto'))
  console.log('[auth/github/callback] CALLBACK_QUERY_DEBUG', JSON.stringify({
    has_code: !!code,
    code_length: code?.length ?? 0,
    has_state: !!returnedState,
    error: error ?? null,
    error_description: errorDescription ?? null,
    all_params: Object.fromEntries(url.searchParams.entries()),
  }))

  // GitHub may redirect with error/error_description (e.g. user denied, redirect_uri_mismatch)
  if (error) {
    console.error('[auth/github/callback] GitHub returned error:', error, errorDescription ?? '')
    const baseUrl = getPublicBaseUrl()
    const reason = error === "redirect_uri_mismatch" ? "callback_mismatch" : error === "access_denied" ? "access_denied" : "oauth_failed"
    return NextResponse.redirect(loginErrorUrl(baseUrl, reason, errorDescription ?? undefined))
  }

  const expectedState = await readStateCookie()
  console.log('[auth/github/callback] Code present:', !!code, 'Expected state:', !!expectedState, 'State match:', returnedState === expectedState)

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    console.error('[auth/github/callback] ERROR: State validation failed', { missing_code: !code, missing_returned_state: !returnedState, missing_expected_state: !expectedState, state_mismatch: returnedState !== expectedState })
    const baseUrl = getPublicBaseUrl()
    return NextResponse.redirect(loginErrorUrl(baseUrl, "oauth_state", "State or code missing. Start sign-in from the app login page."))
  }

  try {
    const redirectUri = buildRedirectUri(req)
    console.log('[auth/github/callback] Using redirect URI for token exchange:', redirectUri)
    console.log('[auth/github/callback] Exchanging code for token...')
    const token = await exchangeCodeForToken(code, redirectUri)
    console.log('[auth/github/callback] Token received, fetching user...')
    const user = await fetchGithubUser(token)
    console.log('[auth/github/callback] User fetched:', user.login)

    const email = await fetchGithubUserEmail(token)

    if (env.TFPILOT_ALLOWED_LOGINS.length > 0 && !env.TFPILOT_ALLOWED_LOGINS.includes(user.login)) {
      console.warn('[auth/github/callback] Login rejected: user not in TFPILOT_ALLOWED_LOGINS:', user.login)
      return NextResponse.redirect(loginErrorUrl(getPublicBaseUrl(), "not_allowed"))
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
      email: email ?? undefined,
      accessToken: token,
    })
    console.log('[auth/github/callback] ===== OAuth Success =====')
    return res
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[auth/github/callback] ===== OAuth Error ===== ", err)
    console.error("[auth/github/callback] Error details:", message)
    const baseUrl = getPublicBaseUrl()
    const isMismatch = /redirect_uri|not associated|callback/i.test(message)
    const isScope = /scope|permission/i.test(message)
    const reason = isMismatch ? "callback_mismatch" : isScope ? "missing_scope" : "oauth_failed"
    return NextResponse.redirect(loginErrorUrl(baseUrl, reason, message))
  }
}
