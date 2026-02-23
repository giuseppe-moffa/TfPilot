"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Github } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/app/providers"

const EXPECTED_CALLBACK = "https://tfpilot.com/api/auth/github/callback"
const REQUIRED_SCOPES = "read:user, user:email, repo"

function OAuthErrorContent({ error, errorDescription }: { error: string; errorDescription: string | null }) {
  const messages: Record<string, { title: string; body: string; fix?: string }> = {
    not_allowed: {
      title: "Access not allowed",
      body: "You're not in the allowed users list.",
      fix: "Contact an admin to get access.",
    },
    oauth_state: {
      title: "Sign-in session expired or invalid",
      body: "The OAuth state didn't match. This often happens if you opened the GitHub install/callback link in a different browser or without starting from this app.",
      fix: "Click « Continue with GitHub » below to start sign-in from this page.",
    },
    callback_mismatch: {
      title: "Callback URL mismatch",
      body: "The redirect URL sent to GitHub doesn't match the one registered for this application.",
      fix: `In GitHub (OAuth App or GitHub App → User authorization callback URL), set the callback to exactly: ${EXPECTED_CALLBACK}. In production, set GITHUB_OAUTH_REDIRECT to the same value.`,
    },
    missing_scope: {
      title: "Missing permissions",
      body: "GitHub didn't grant the required scopes, or the app doesn't have permission to access the resource.",
      fix: `Sign out of this app and sign in again; when GitHub asks, grant repo (and profile) access. Required scopes: ${REQUIRED_SCOPES}. For a GitHub App, set Contents to Read and write and install the app on the repo.`,
    },
    wrong_app: {
      title: "Wrong OAuth application",
      body: "The Client ID used by this environment doesn't match the app where the callback URL is registered.",
      fix: "Use the same GitHub OAuth App or GitHub App for both GITHUB_CLIENT_ID and the callback URL. Check that production env has the correct client ID and that the callback is added to that app.",
    },
    access_denied: {
      title: "Access denied",
      body: "You cancelled the authorization or GitHub denied access.",
      fix: "Click « Continue with GitHub » and approve the requested permissions.",
    },
    oauth_failed: {
      title: "Sign-in failed",
      body: errorDescription || "GitHub token exchange or user fetch failed.",
      fix: "Try again. If it persists, check that the app's Client ID and Secret match the app registered in GitHub, and that the callback URL is correct.",
    },
  }
  const m = messages[error] || messages.oauth_failed
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive space-y-2">
      <p className="font-medium">{m.title}</p>
      <p>{m.body}</p>
      {m.fix && <p className="text-muted-foreground pt-1 border-t border-destructive/20 mt-2">{m.fix}</p>}
      {errorDescription && error !== "oauth_failed" && (
        <p className="text-xs opacity-80 pt-1">Details: {errorDescription}</p>
      )}
    </div>
  )
}

export function LoginClient() {
  const { user, loading } = useAuth()
  const params = useSearchParams()
  const router = useRouter()
  const next = params.get("next") || "/requests"
  const error = params.get("error")
  const errorDescription = params.get("error_description")

  useEffect(() => {
    if (!loading && user) {
      router.replace(next)
    }
  }, [loading, user, next, router])

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in with GitHub</CardTitle>
          <CardDescription>
            Authenticate to tfplan using GitHub. This does not grant AWS access keys; the app will
            assume your AWS role via GitHub OIDC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <OAuthErrorContent error={error} errorDescription={errorDescription} />
          )}
          <Button 
            className="w-full gap-2" 
            onClick={() => {
              console.log('[LoginClient] OAuth button clicked')
              console.log('[LoginClient] Current location:', window.location.href)
              // Force full page navigation to avoid RSC/CORS issues
              const oauthUrl = '/api/auth/github/start'
              console.log('[LoginClient] Navigating to:', oauthUrl)
              window.location.href = oauthUrl
            }}
          >
            <Github className="h-4 w-4" />
            Continue with GitHub
          </Button>
          <p className="text-xs text-muted-foreground">
            We request scopes: <code>read:user</code> and <code>repo</code> (for private repos). No
            tokens are stored in localStorage; the session uses a secure cookie.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
