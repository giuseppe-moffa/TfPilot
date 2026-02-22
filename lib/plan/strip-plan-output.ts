/**
 * Strip raw job log / plan output to only the Terraform execution plan content:
 * from "Terraform used the selected providers..." (or "Resource actions are indicated...")
 * through the plan summary. Removes init blurb, GitHub Actions wrapper, ANSI codes.
 */
export function stripPlanOutputToContent(raw: string): string {
  if (!raw || !raw.trim()) return raw
  const text = stripAnsi(raw)
  const lower = text.toLowerCase()
  const markers = [
    "terraform used the selected providers to generate the following execution",
    "resource actions are indicated by the following symbols:",
  ]
  for (const marker of markers) {
    const idx = lower.indexOf(marker)
    if (idx !== -1) return text.slice(idx).trimStart()
  }
  return text
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}
