"use client"

const STATUS_COLORS: Record<string, string> = {
  "Request created": "#4C8DFF",
  "Plan ready": "#EAB03D", // amber ~5% softer than #F5B942
  "Approved, awaiting merge": "#9B7CFF",
  "Pull request merged": "#6A8DFF",
  "Deployment Completed": "#3ECF8E",
  Destroying: "#F59E0B",
  Destroyed: "#8A94A6",
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
