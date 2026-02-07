"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAwsConnection } from "@/app/providers"

type Identity = {
  arn: string
  accountId: string
  region: string
}

type Mode = "keys" | "role"

export default function AwsConnectPage() {
  const [mode, setMode] = React.useState<Mode>("keys")
  const [accessKeyId, setAccessKeyId] = React.useState("")
  const [secretAccessKey, setSecretAccessKey] = React.useState("")
  const [regionKeys, setRegionKeys] = React.useState("")
  const [roleArn, setRoleArn] = React.useState("")
  const [regionRole, setRegionRole] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [identity, setIdentity] = React.useState<Identity | null>(null)
  const { setConnection } = useAwsConnection()

  const requiredFilled =
    mode === "keys"
      ? accessKeyId.trim() !== "" && secretAccessKey.trim() !== "" && regionKeys.trim() !== ""
      : roleArn.trim() !== "" && regionRole.trim() !== ""

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!requiredFilled) return
    setIsSubmitting(true)
    setError(null)
    setIdentity(null)

    const payload =
      mode === "keys"
        ? {
            accessKeyId: accessKeyId.trim(),
            secretAccessKey: secretAccessKey.trim(),
            region: regionKeys.trim(),
          }
        : {
            assumeRoleArn: roleArn.trim(),
            region: regionRole.trim(),
          }

    try {
      const res = await fetch("/api/connect/aws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as {
        success: boolean
        identity?: Identity
        error?: string
      }
      if (!res.ok || !data.success || !data.identity) {
        throw new Error(data.error || "Invalid credentials")
      }
      setIdentity(data.identity)
      setConnection({
        isConnected: true,
        accountId: data.identity.accountId,
        region: data.identity.region,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Connect your AWS account</CardTitle>
          <CardDescription>
            Choose an authentication method to validate your AWS identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="space-y-6"
          >
            <TabsList>
              <TabsTrigger value="keys">Access Keys</TabsTrigger>
              <TabsTrigger value="role">Assume Role</TabsTrigger>
            </TabsList>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <TabsContent value="keys" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="accessKeyId">Access Key ID</Label>
                    <Input
                      id="accessKeyId"
                      value={accessKeyId}
                      onChange={(e) => setAccessKeyId(e.target.value)}
                      required={mode === "keys"}
                      placeholder="AKIA..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secretAccessKey">Secret Access Key</Label>
                    <Input
                      id="secretAccessKey"
                      type="password"
                      value={secretAccessKey}
                      onChange={(e) => setSecretAccessKey(e.target.value)}
                      required={mode === "keys"}
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="regionKeys">Region</Label>
                    <Input
                      id="regionKeys"
                      value={regionKeys}
                      onChange={(e) => setRegionKeys(e.target.value)}
                      required={mode === "keys"}
                      placeholder="us-east-1"
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="role" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="roleArn">Role ARN</Label>
                  <Input
                    id="roleArn"
                    value={roleArn}
                    onChange={(e) => setRoleArn(e.target.value)}
                    required={mode === "role"}
                    placeholder="arn:aws:iam::123456789012:role/MyRole"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regionRole">Region</Label>
                  <Input
                    id="regionRole"
                    value={regionRole}
                    onChange={(e) => setRegionRole(e.target.value)}
                    required={mode === "role"}
                    placeholder="us-east-1"
                  />
                </div>
              </TabsContent>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  We will call AWS STS GetCallerIdentity to validate these credentials.
                </div>
                <Button type="submit" disabled={!requiredFilled || isSubmitting} className="cursor-pointer">
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Connect
                </Button>
              </div>
            </form>
          </Tabs>

          <div className="mt-6 space-y-3">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {identity && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                <div className="font-semibold">Connected</div>
                <div>ARN: {identity.arn}</div>
                <div>Account ID: {identity.accountId}</div>
                <div>Region: {identity.region}</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
