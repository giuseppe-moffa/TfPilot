/**
 * Prevent regressions: app/ and lib/ must be workspace-only (no legacy environment_*).
 * Run: npm run validate:legacy-env
 *
 * Forbidden in app/ and lib/:
 * - envs/${environment} (use envs/${workspace_key}/${workspace_slug})
 * - request.environment (use request.workspace_key)
 * - request.project (use request.project_key)
 * - .environment_id, .environment_key, .environment_slug (use workspace_*)
 * - environment_key ?? ... fallbacks (use workspace_key only)
 */

import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(__dirname, "..")
const DIRS = ["app", "lib"]

function collectFiles(dir: string, ext: string[]): string[] {
  const out: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".next") {
          out.push(...collectFiles(full, ext))
        }
      } else if (ext.some((x) => e.name.endsWith(x))) {
        out.push(full)
      }
    }
  } catch {
    // Dir may not exist
  }
  return out
}

const CHECKS: Array<{ pattern: RegExp; msg: string }> = [
  { pattern: /envs\/\$\{\s*environment\s*\}/, msg: "Legacy envs/${environment} path (use workspace_key/workspace_slug)" },
  { pattern: /request\.environment(?!_|_id|Key|Slug)/, msg: "Legacy request.environment (use request.workspace_key)" },
  { pattern: /request\.project(?!_|Key)/, msg: "Legacy request.project (use request.project_key)" },
  { pattern: /\.environment_key\s*\?\?\s*[^(]*\.environment\b/, msg: "Legacy fallback (use workspace_key only)" },
  { pattern: /\.environment_id\b/, msg: "Legacy .environment_id (use .workspace_id)" },
  { pattern: /\.environment_key\b/, msg: "Legacy .environment_key (use .workspace_key)" },
  { pattern: /\.environment_slug\b/, msg: "Legacy .environment_slug (use .workspace_slug)" },
]

function main() {
  const files = DIRS.flatMap((d) => collectFiles(path.join(ROOT, d), [".ts", ".tsx"]))
  const errors: { file: string; line: number; msg: string; excerpt: string }[] = []

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Skip envs check if line already uses workspace_key/slug
      if (CHECKS[0].pattern.test(line) && /workspace_(key|slug)/.test(line)) continue
      for (const { pattern, msg } of CHECKS) {
        if (pattern.test(line)) {
          errors.push({
            file: path.relative(ROOT, file),
            line: i + 1,
            msg,
            excerpt: line.trim().slice(0, 120),
          })
          break
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("validate:legacy-env failed — forbidden patterns:\n")
    for (const e of errors) {
      console.error(`  ${e.file}:${e.line} ${e.msg}`)
      console.error(`    ${e.excerpt}`)
    }
    process.exit(1)
  }
  console.log("validate:legacy-env passed")
}

main()
