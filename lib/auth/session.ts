import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import crypto from "node:crypto"

type SessionPayload = {
  login: string
  name: string | null
  avatarUrl: string | null
  email?: string | null
  accessToken?: string | null
}

const SESSION_COOKIE = "tfplan_session"
const STATE_COOKIE = "tfplan_oauth_state"
const MAX_AGE_SECONDS = 60 * 60 * 12 // 12h

function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not set")
  return secret
}

function sign(value: string) {
  const hmac = crypto.createHmac("sha256", getSecret())
  hmac.update(value)
  return hmac.digest("base64url")
}

function encodePayload(payload: SessionPayload) {
  const base = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = sign(base)
  return `${base}.${signature}`
}

export function decodeSessionToken(token: string): SessionPayload | null {
  const [base, signature] = token.split(".")
  if (!base || !signature) return null
  const expected = sign(base)
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  try {
    const json = Buffer.from(base, "base64url").toString("utf8")
    return JSON.parse(json) as SessionPayload
  } catch {
    return null
  }
}

type CookieStore = Awaited<ReturnType<typeof cookies>>

async function resolveStore(store?: ReturnType<typeof cookies> | CookieStore) {
  if (!store) return await cookies()
  // newer Next.js returns a Promise from cookies(); handle both cases
  // eslint-disable-next-line @typescript-eslint/await-thenable
  return store instanceof Promise ? await store : store
}

export async function getSessionFromCookies(store?: ReturnType<typeof cookies> | CookieStore) {
  const jar = await resolveStore(store)
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  return decodeSessionToken(token)
}

export function setSession(res: NextResponse, payload: SessionPayload) {
  const token = encodePayload(payload)
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}

/** In production, set domain so the cookie is sent when GitHub redirects back to tfpilot.com. */
function stateCookieDomain(): string | undefined {
  const redirect = process.env.GITHUB_OAUTH_REDIRECT
  if (!redirect) return undefined
  try {
    const host = new URL(redirect).hostname
    if (host && host !== "localhost" && !host.startsWith("127.")) return host
  } catch {}
  return undefined
}

export function setStateCookie(res: NextResponse, value: string) {
  const domain = stateCookieDomain()
  res.cookies.set(STATE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    ...(domain && { domain }),
  })
}

export async function readStateCookie(store?: ReturnType<typeof cookies> | CookieStore) {
  const jar = await resolveStore(store)
  return jar.get(STATE_COOKIE)?.value || null
}

export function clearStateCookie(res: NextResponse) {
  const domain = stateCookieDomain()
  res.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(domain && { domain }),
  })
}
