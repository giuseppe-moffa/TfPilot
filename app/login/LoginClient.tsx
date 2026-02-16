"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useSearchParams, useRouter } from "next/navigation"
import { Github } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/app/providers"

export function LoginClient() {
  const { user, loading } = useAuth()
  const params = useSearchParams()
  const router = useRouter()
  const next = params.get("next") || "/requests"
  const error = params.get("error")

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
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Sign-in failed. Please try again.
            </div>
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
