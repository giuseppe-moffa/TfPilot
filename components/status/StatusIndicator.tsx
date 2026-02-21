"use client"

import { getStatusMeta, type CanonicalStatus } from "@/lib/status/status-config"

export { getStatusColor } from "@/lib/status/status-config"

type StatusIndicatorProps = {
  status: CanonicalStatus
  variant?: "default" | "pill"
}

export function StatusIndicator({ status, variant = "default" }: StatusIndicatorProps) {
  const meta = getStatusMeta(status)
  const glowColor = `${meta.color}30`
  const bgTint = `${meta.color}26`
  const borderTint = `${meta.color}40`

  const dot = (
    <span
      className="shrink-0 rounded-full opacity-95"
      style={{
        width: variant === "pill" ? 8 : 9,
        height: variant === "pill" ? 8 : 9,
        backgroundColor: meta.color,
        boxShadow: `0 0 4px 0 ${glowColor}`,
      }}
      aria-hidden
    />
  )

  const label = (
    <span
      className="text-sm font-medium leading-none"
      style={{ color: meta.color }}
    >
      {meta.label}
    </span>
  )

  if (variant === "pill") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5"
        style={{
          backgroundColor: bgTint,
          border: `1px solid ${borderTint}`,
        }}
      >
        {dot}
        {label}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 leading-none">
      {dot}
      {label}
    </span>
  )
}
