"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ExternalLink, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAwsConnection } from "@/app/providers"

const rawTemplateUrl =
  "https://raw.githubusercontent.com/giuseppe-moffa/TfPilot/main/tfplan-ui/public/tfplan-stack.yaml"
const templateUrl = `https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?stackName=tfplan-connector&templateURL=${encodeURIComponent(rawTemplateUrl)}`

type Identity = {
  arn: string
  accountId: string
  region: string
}

type Mode = "keys" | "role"

export default function AwsConnectPage() {
  const router = useRouter()
  const { isConnected, setConnection } = useAwsConnection()
  const [mode, setMode] = React.useState<Mode>("keys")
  const [accessKeyId, setAccessKeyId] = React.useState("")
  const [secretAccessKey, setSecretAccessKey] = React.useState("")
  const [regionKeys, setRegionKeys] = React.useState("")
  const [roleArn, setRoleArn] = React.useState("")
  const [regionRole, setRegionRole] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [identity, setIdentity] = React.useState<Identity | null>(null)

  React.useEffect(() => {
    if (isConnected) {
      router.replace("/requests")
    }
  }, [isConnected, router])

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
        throw new Error(data.error || "Unable to validate the AWS connection")
      }

      setIdentity(data.identity)
      setConnection({
        isConnected: true,
        accountId: data.identity.accountId,
        region: data.identity.region,
      })
      router.replace("/requests")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to validate the AWS connection"
      setError(
        `${message}. Confirm the stack role allows sts:GetCallerIdentity and that your credentials/role ARN match the region you selected.`
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">AWS Connect</h1>
        <p className="text-muted-foreground">
          Launch the tfplan CloudFormation stack from GitHub, then validate the connection.
        </p>
      </div>

      <Card className="max-w-4xl">
        <CardHeader className="border-b">
          <CardTitle>Connect with CloudFormation</CardTitle>
          <CardDescription>
            Deploy the tfplan stack from GitHub to create a GitHub OIDC-backed IAM role.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex flex-wrap items-center gap-3">
                <Button asChild>
                  <Link href={templateUrl} target="_blank" rel="noreferrer">
                    Launch CloudFormation
                  </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={rawTemplateUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2">
                <ExternalLink className="size-4" />
                View template
              </Link>
            </Button>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Open the quick-create link and review the parameters.</li>
            <li>Deploy the stack to create the tfplan IAM role.</li>
            <li>Copy the created role ARN or credentials for validation below.</li>
          </ol>
        </CardContent>
      </Card>

      <Card className="max-w-4xl">
        <CardHeader className="border-b">
          <CardTitle>Validate the connection</CardTitle>
          <CardDescription>
            Use the role or access keys created by the stack to verify tfplan can call AWS STS.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="space-y-6">
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
                    placeholder="arn:aws:iam::123456789012:role/tfplan-connector"
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
                  Validate
                </Button>
              </div>
            </form>
          </Tabs>

          <div className="mt-6 space-y-3">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <div className="font-semibold">Connection failed</div>
                <div>{error}</div>
                <div className="text-xs text-destructive/80">
                  If it keeps failing, confirm the stack finished and the role policy allows sts:AssumeRole / GetCallerIdentity.
              </div>
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