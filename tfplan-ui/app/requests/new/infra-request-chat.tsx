"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Props = {
  projects: string[]
  environments: string[]
  moduleSchemas: Record<
    string,
    Array<{
      id: string
      label: string
      type: "string" | "number" | "boolean" | "select"
      options?: string[]
      default?: any
      required?: boolean
    }>
  >
  onComplete: (data: { project: string; environment: string; module: string; config: Record<string, any> }) => void
  onSubmit?: (payload: { project: string; environment: string; module: string; config: Record<string, any> }) => Promise<void> | void
}

const bubble =
  "max-w-[80%] rounded-2xl px-4 py-3 shadow-sm text-sm leading-relaxed transition-all duration-200"

export function InfraRequestChat({ projects, environments, onComplete, moduleSchemas, onSubmit }: Props) {
  const [project, setProject] = React.useState<string>("")
  const [environment, setEnvironment] = React.useState<string>("")
  const [module, setModule] = React.useState<string>("")
  const [config, setConfig] = React.useState<Record<string, any>>({})
  const [questionIndex, setQuestionIndex] = React.useState<number>(0)
  const [showSummary, setShowSummary] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  const projectSelected = Boolean(project)
  const envSelected = Boolean(environment)
  const readyForModule = projectSelected && envSelected
  const questions = module ? moduleSchemas[module] || [] : []
  const allQuestionsAnswered =
    questions.length > 0 && questionIndex >= questions.length && Object.keys(config).length >= questions.length

  const handleModule = (value: string) => {
    setModule(value)
    setConfig(
      Object.fromEntries(
        (moduleSchemas[value] || []).map((q) => [q.id, q.default !== undefined ? q.default : ""])
      )
    )
    setQuestionIndex(0)
  }

  const handleAnswer = (id: string, value: any) => {
    setConfig((prev) => ({ ...prev, [id]: value }))
    setQuestionIndex((idx) => Math.min(idx + 1, questions.length))
  }

  React.useEffect(() => {
    if (module && allQuestionsAnswered) {
      onComplete({ project, environment, module, config })
      setShowSummary(true)
    }
  }, [allQuestionsAnswered, config, environment, module, onComplete, project])

  const messages = [
    {
      id: "welcome",
      role: "bot" as const,
      text: "Hey! I’ll help you provision infrastructure in a few steps. Let’s start.",
    },
    {
      id: "project",
      role: "bot" as const,
      text: "Which project is this for?",
      control: (
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-full max-w-xs bg-white">
            <SelectValue placeholder="Select a project" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      userEcho: project,
    },
    {
      id: "environment",
      role: "bot" as const,
      text: "Which environment?",
      control: (
        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger className="w-full max-w-xs bg-white">
            <SelectValue placeholder="Select an environment" />
          </SelectTrigger>
          <SelectContent>
            {environments.map((env) => (
              <SelectItem key={env} value={env}>
                {env}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      userEcho: environment,
    },
  ]

  const renderQuestion = (q: (typeof questions)[number]) => {
    const current = questions[questionIndex]
    const isActive = q.id === current?.id
    const answered = config[q.id] !== undefined && config[q.id] !== ""

    if (!isActive && !answered) return null

    return (
      <div key={q.id} className="flex flex-col gap-2">
        <div className="flex justify-start">
          <div className={`${bubble} bg-slate-100 text-slate-800`}>{q.label}</div>
        </div>

        <div className="flex justify-start">
          {q.type === "boolean" ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleAnswer(q.id, true)}>
                Yes
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAnswer(q.id, false)}>
                No
              </Button>
            </div>
          ) : q.type === "select" ? (
            <Select
              value={String(config[q.id] ?? "")}
              onValueChange={(val) => handleAnswer(q.id, val)}
            >
              <SelectTrigger className="w-full max-w-xs bg-white">
                <SelectValue placeholder="Choose an option" />
              </SelectTrigger>
              <SelectContent>
                {(q.options || []).map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <input
              className="w-full max-w-xs rounded-2xl border px-3 py-2 text-sm shadow-sm"
              type={q.type === "number" ? "number" : "text"}
              defaultValue={q.default ?? ""}
              onBlur={(e) => handleAnswer(q.id, q.type === "number" ? Number(e.target.value) : e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleAnswer(
                    q.id,
                    q.type === "number" ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value
                  )
                }
              }}
            />
          )}
        </div>

        {answered && (
          <div className="flex justify-end">
            <div className={`${bubble} bg-primary text-primary-foreground`}>
              {typeof config[q.id] === "boolean" ? (config[q.id] ? "Yes" : "No") : String(config[q.id])}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <AnimatePresence>
          {messages.map((message) => (
            <React.Fragment key={message.id}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex justify-start"
              >
                <div className={`${bubble} bg-slate-100 text-slate-800`}>{message.text}</div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex justify-start"
              >
                {message.control}
              </motion.div>

              {message.userEcho && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex justify-end"
                >
                  <div className={`${bubble} bg-primary text-primary-foreground`}>
                    {message.userEcho}
                  </div>
                </motion.div>
              )}
            </React.Fragment>
          ))}

          {readyForModule && (
            <motion.div
              key="module-prompt"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="flex flex-col gap-3"
            >
              <div className="flex justify-start">
                <div className={`${bubble} bg-slate-100 text-slate-800`}>
                  Awesome! What kind of infrastructure do you want to create?
                </div>
              </div>
              <div className="flex flex-wrap gap-2 justify-start">
                {Object.keys(moduleSchemas).map((mod) => (
                  <Button
                    key={mod}
                    variant={module === mod ? "default" : "outline"}
                    onClick={() => handleModule(mod)}
                    className="capitalize"
                  >
                    {mod.replace("-", " ")}
                  </Button>
                ))}
              </div>
            </motion.div>
          )}
          {module &&
            questions.map((q, idx) => (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: idx <= questionIndex ? 1 : 0, y: idx <= questionIndex ? 0 : 8 }}
                transition={{ delay: idx * 0.05 }}
              >
                {renderQuestion(q)}
              </motion.div>
            ))}

          {showSummary && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-3"
            >
              <div className="flex justify-start">
                <div className={`${bubble} bg-slate-100 text-slate-800`}>
                  Here&apos;s a summary of your request. Please confirm to proceed.
                </div>
              </div>
              <div className="rounded-lg border bg-slate-50 p-4 shadow-sm">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Summary</h4>
                <div className="grid gap-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Project</span>
                    <span className="font-medium text-slate-800">{project || "Missing"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Environment</span>
                    <span className="font-medium text-slate-800">{environment || "Missing"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500">Module</span>
                    <span className="font-medium text-slate-800">{module || "Missing"}</span>
                  </div>
                  <div className="pt-2">
                    <span className="text-slate-500">Configuration</span>
                    <div className="mt-2 space-y-1 rounded-md border bg-white p-3 text-xs text-slate-700">
                      {Object.keys(config).length === 0 && <div className="text-slate-400">No config provided</div>}
                      {Object.entries(config).map(([key, val]) => (
                        <div key={key} className="flex justify-between gap-2">
                          <span className="font-medium text-slate-800">{key}</span>
                          <span className="text-slate-600 break-words">{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={submitting}
                  onClick={async () => {
                    if (!onSubmit) return
                    setSubmitting(true)
                    try {
                      await onSubmit({ project, environment, module, config })
                    } finally {
                      setSubmitting(false)
                    }
                  }}
                >
                  {submitting ? "Submitting..." : "Confirm & Submit"}
                </Button>
                <Button variant="outline" onClick={() => setShowSummary(false)}>
                  Edit Answers
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
