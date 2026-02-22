import { moduleRegistry } from "@/config/module-registry"
import { buildResourceName, validateResourceName } from "@/lib/requests/naming"

function checkEntry(entry: any) {
  const issues: string[] = []
  const fields = ["name", "bucket_name", "queue_name", "service_name"]
  for (const field of fields) {
    if (!entry[field]) continue
    const candidate = buildResourceName(String(entry[field]), "req_sample_abc123")
    if (!validateResourceName(candidate)) {
      issues.push(`Field ${field} => ${candidate} violates name regex/length`)
    }
  }
  return issues
}

function main() {
  const problems: string[] = []
  for (const entry of moduleRegistry) {
    const sample = { name: "sample-name" }
    const issues = checkEntry(sample)
    if (issues.length > 0) {
      problems.push(`${entry.type}: ${issues.join("; ")}`)
    }
  }
  if (problems.length > 0) {
    console.error("Name validation issues:", problems.join(" | "))
    process.exit(1)
  }
  console.log("Name validation passed for sample inputs.")
}

main()
