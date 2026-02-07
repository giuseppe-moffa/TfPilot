"use client"

import * as React from "react"
import Link from "next/link"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const externalId = "ext-4c8b-aws-9071"
const templateUrl =
  "https://console.aws.amazon.com/cloudformation/home#/stacks/create/review?templateURL=https://example.com/infraforge-stack.yaml"

export default function AwsConnectPage() {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(externalId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">AWS Connect</h1>
        <p className="text-muted-foreground">
          Connect your AWS account by launching a CloudFormation stack.
        </p>
      </div>

      <Card className="max-w-3xl">
        <CardHeader className="border-b">
          <CardTitle>External ID & Stack Launch</CardTitle>
          <CardDescription>
            Use this External ID when prompted in the AWS console, then launch
            the stack to grant InfraForge access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">External ID for AWS Console</p>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input readOnly value={externalId} className="md:max-w-sm" />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopy}
                  className="flex items-center gap-2"
                >
                  {copied ? (
                    <>
                      <Check className="size-4" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" />
                      Copy
                    </>
                  )}
                </Button>
                <Button asChild>
                  <Link href={templateUrl} target="_blank" rel="noreferrer">
                    Launch CloudFormation
                  </Link>
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Keep this ID secure. Paste it into the “External ID” field when
              creating the stack.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold">Setup steps</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>Copy the External ID above.</li>
              <li>Click “Launch CloudFormation” to open AWS.</li>
              <li>Paste the External ID in the console when prompted.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}