"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AgentChat } from "@/components/agent-chat"
import { listEnvironments, listProjects } from "@/config/infra-repos"

export default function NewRequestPage() {
  const [project, setProject] = React.useState("")
  const [environment, setEnvironment] = React.useState("")
  const [modules, setModules] = React.useState<string[]>([])
  const [loadingModules, setLoadingModules] = React.useState(false)
  const projects = listProjects()
  const environments = project ? listEnvironments(project) : []
  const canStartChat = Boolean(project && environment)

  React.useEffect(() => {
    const loadModules = async () => {
      setLoadingModules(true)
      try {
        const res = await fetch("/api/modules")
        const data = (await res.json()) as { modules: Array<{ name: string }> }
        const names = data.modules?.map((m) => m.name).filter(Boolean) ?? []
        setModules(names.length > 0 ? names : ["s3-bucket", "sqs-queue", "ecs-service"])
      } catch {
        setModules(["s3-bucket", "sqs-queue", "ecs-service"])
      } finally {
        setLoadingModules(false)
      }
    }
    void loadModules()
  }, [])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <Link href="/requests">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">New Request</h1>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <Card className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
          <div className="space-y-2">
            <p className="text-sm font-medium">Project</p>
            <Select value={project} onValueChange={setProject} disabled={Boolean(project)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Environment</p>
            <Select value={environment} onValueChange={setEnvironment} disabled={Boolean(environment)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((env) => (
                  <SelectItem key={env} value={env}>
                    {env}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Card>
        {loadingModules && <p className="text-xs text-muted-foreground">Loading modules...</p>}

        <div className="flex-1 rounded-lg border border-border bg-card p-4 shadow-sm">
          {canStartChat ? (
            <AgentChat
              systemPrompt={`You are an AI Infrastructure Assistant inside a Terraform self-service platform. Help the developer provision infrastructure modules in the selected project and environment. Ask what they want to create, and guide them step-by-step with simple questions. Don't require them to know Terraform.`}
              project={project}
              environment={environment}
              initialUserContext={`Project: ${project}\nEnvironment: ${environment}`}
              modules={modules}
              requireModuleBeforeInput
            />
          ) : (
            <div className="text-sm text-muted-foreground">
              Select a project and environment to start the chat.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}