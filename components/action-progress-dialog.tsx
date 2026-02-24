"use client"

import * as React from "react"
import { Check, Loader2 } from "lucide-react"

export type StepStatus = "done" | "in_progress" | "pending"

export type ActionProgressStep = {
  label: string
  status: StepStatus
}

type ActionProgressDialogProps = {
  open: boolean
  title: string
  body: string
  steps: ActionProgressStep[]
}

export function ActionProgressDialog({
  open,
  title,
  body,
  steps,
}: ActionProgressDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 transition-opacity"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="min-w-[280px] max-w-sm rounded-lg border border-border bg-card px-5 py-4 shadow-lg">
        <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {steps.map((step, i) => (
                <li key={i} className="flex items-center gap-2">
                  {step.status === "done" && (
                    <Check
                      className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  )}
                  {step.status === "in_progress" && (
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  {step.status === "pending" && (
                    <span
                      className="size-3.5 shrink-0 rounded-full border border-muted-foreground/40"
                      aria-hidden
                    />
                  )}
                  <span className={step.status === "pending" ? "opacity-80" : undefined}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ul>
        </div>
      </div>
    </div>
  )
}
