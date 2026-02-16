import { NextResponse, type NextRequest } from "next/server"

import { clearSession, clearStateCookie, readStateCookie, setSession } from "@/lib/auth/session"

async function exchangeCodeForToken(code: string, redirectUri: string) {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Missing GitHub client configuration")
  }

  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!resp.ok) throw new Error("GitHub token exchange failed")
  const data = (await resp.json()) as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(data.error || "Missing access token")
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
  // Always prefer the environment variable if set
  const envRedirect = process.env.GITHUB_OAUTH_REDIRECT
  if (envRedirect) {
    console.log('[auth/github/callback] Using GITHUB_OAUTH_REDIRECT:', envRedirect)
    return envRedirect
  }
  
  // Fallback: use the Host header (which should be the public domain via ALB)
  const host = req.headers.get('host')
  console.log('[auth/github/callback] Host header:', host)
  
  if (host && !host.includes('compute.internal') && !host.includes('localhost')) {
    // Use https for production
    const uri = `https://${host}/api/auth/github/callback`
    console.log('[auth/github/callback] Using Host header:', uri)
    return uri
  }
  
  // If Host header is internal/localhost, use the hardcoded public domain
  const publicDomain = 'tfpilot.com'
  const uri = `https://${publicDomain}/api/auth/github/callback`
  console.log('[auth/github/callback] Using fallback domain:', uri)
  return uri
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const returnedState = url.searchParams.get("state")
  const expectedState = await readStateCookie()

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=oauth_state", req.url))
  }

  try {
    const redirectUri = buildRedirectUri(req)
    console.log('[auth/github/callback] Using redirect URI for token exchange:', redirectUri)
    const token = await exchangeCodeForToken(code, redirectUri)
    const user = await fetchGithubUser(token)

    const res = NextResponse.redirect(new URL("/requests", req.url))
    clearStateCookie(res)
    clearSession(res)
    setSession(res, {
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      accessToken: token,
    })
    return res
  } catch (error) {
    console.error("[auth/github/callback] error", error)
    return NextResponse.redirect(new URL("/login?error=oauth_failed", req.url))
  }
}
