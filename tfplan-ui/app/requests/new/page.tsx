"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function NewRequestPage() {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [project, setProject] = React.useState("")
  const [environment, setEnvironment] = React.useState("")
  const [module, setModule] = React.useState("")
  const [serviceName, setServiceName] = React.useState("")
  const [cpu, setCpu] = React.useState("")
  const [memory, setMemory] = React.useState("")

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      project,
      environment,
      module,
      config: {
        name: serviceName,
        serviceName,
        cpu,
        memory,
      },
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const message =
            data?.errors?.join(", ") ||
            data?.error ||
            "Failed to submit request"
          alert(message)
          return
        }

        const data = (await res.json()) as { requestId?: string }
        const requestId = data.requestId ?? "req_01TEST"
        alert("Request submitted successfully")
        router.push(`/requests/${requestId}`)
      } catch (error) {
        console.error("[new request] submit error", error)
        alert("Something went wrong. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-xl font-semibold">
            New Infrastructure Request
          </CardTitle>
          <CardDescription>
            Choose a project, environment, and module, then provide the module
            configuration details.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8 pt-6">
          <form className="space-y-8" onSubmit={handleSubmit}>
            <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Select Context</h2>
              <p className="text-sm text-muted-foreground">
                Pick the project, target environment, and module to provision.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <Select value={project} onValueChange={setProject}>
                  <SelectTrigger id="project" className="w-full">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payments">Payments</SelectItem>
                    <SelectItem value="analytics">Analytics</SelectItem>
                    <SelectItem value="core">Core Platform</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose the owning product or service area.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="environment">Environment</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger id="environment" className="w-full">
                    <SelectValue placeholder="Select an environment" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dev">Development</SelectItem>
                    <SelectItem value="staging">Staging</SelectItem>
                    <SelectItem value="prod">Production</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Target environment for this request.
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="module">Module</Label>
                <Select value={module} onValueChange={setModule}>
                  <SelectTrigger id="module" className="w-full">
                    <SelectValue placeholder="Select a module" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">ECS Service</SelectItem>
                    <SelectItem value="queue">SQS Queue</SelectItem>
                    <SelectItem value="database">RDS Database</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pick the infrastructure module to deploy.
                </p>
              </div>
            </div>
            </section>

            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Module Config</h2>
                <p className="text-sm text-muted-foreground">
                  Provide module-specific parameters. Values are examples and can
                  be adjusted later.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="serviceName">Service name</Label>
                  <Input
                    id="serviceName"
                    placeholder="e.g. checkout-api"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Human-friendly name for the service or module instance.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cpu">CPU (units)</Label>
                  <Input
                    id="cpu"
                    type="number"
                    placeholder="e.g. 512"
                    value={cpu}
                    onChange={(e) => setCpu(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    CPU allocation; common values are 256, 512, 1024.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="memory">Memory (MiB)</Label>
                  <Input
                    id="memory"
                    type="number"
                    placeholder="e.g. 1024"
                    value={memory}
                    onChange={(e) => setMemory(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Memory reservation in MiB.
                  </p>
                </div>
              </div>
            </section>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" asChild disabled={isPending}>
                <Link href="/requests">Cancel</Link>
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}