"use client"

import * as React from "react"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export type StepStatus = "done" | "in_progress" | "pending"

export type ActionProgressStep = {
  label: string
  status: StepStatus
}

export type ActionProgressState = "running" | "success" | "error"

type ActionProgressDialogProps = {
  open: boolean
  title: string
  body: string
  steps: ActionProgressStep[]
  state?: ActionProgressState
  errorMessage?: string
  onDismiss?: () => void
  onRetry?: () => void
}

export function ActionProgressDialog({
  open,
  title,
  body,
  steps,
  state = "running",
  errorMessage,
  onDismiss,
  onRetry,
}: ActionProgressDialogProps) {
  if (!open) return null
  const isRunning = state === "running"
  const isSuccess = state === "success"
  const isError = state === "error"
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 transition-opacity"
      aria-live="polite"
      aria-busy={isRunning}
    >
      <div className="min-w-[280px] max-w-sm rounded-lg border border-border bg-card px-5 py-4 shadow-lg">
        <div className="space-y-3">
          {isSuccess ? (
            <>
              <div className="flex items-center gap-2">
                <Check className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-medium text-foreground">{title.replace("…", "")} completed</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
            </>
          ) : isError ? (
            <>
              <p className="text-sm font-medium text-destructive">Something went wrong</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {errorMessage ?? "Please try again."}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {onRetry && (
                  <Button size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                )}
                {onDismiss && (
                  <Button size="sm" variant="outline" onClick={onDismiss}>
                    Dismiss
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
