"use client"

const STATUS_COLORS: Record<string, string> = {
  "Request created": "#3B82F6",        // blue-500 (info)
  "Planning in progress": "#2563EB",   // blue-600 (active info)

  "Plan ready": "#F59E0B",             // amber-500 (attention / ready)

  Approved: "#8B5CF6",                 // violet-500 (decision state)

  "Pull request merged": "#6366F1",    // indigo-500 (code workflow)

  "Deployment Completed": "#10B981",   // emerald-500 (success)

  Destroying: "#F97316",               // orange-500 (active destructive)

  Destroyed: "#6B7280",                // gray-500 (inactive / terminal)

  Failed: "#EF4444",                   // red-500 (error)
}

const FALLBACK_COLOR = "#8A94A6"

function getColorForLabel(label: string): string {
  const key = label.trim()
  return STATUS_COLORS[key] ?? FALLBACK_COLOR
}

export function StatusIndicator({ label }: { label: string }) {
  const color = getColorForLabel(label)
  const trimmedLabel = label.trim()

  const glowColor = `${color}40` // same color at ~25% opacity for subtle depth

  return (
    <span className="inline-flex items-center gap-2 leading-none">
      <span
        className="shrink-0 rounded-full opacity-95"
        style={{
          width: 9,
          height: 9,
          backgroundColor: color,
          boxShadow: `0 0 8px 0 ${glowColor}`,
        }}
        aria-hidden
      />
      <span className="leading-none">{trimmedLabel || label}</span>
    </span>
  )
}
