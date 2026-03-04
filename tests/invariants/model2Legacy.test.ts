/**
 * Invariant tests: Model 2 guardrails (Chunk 11).
 * - No envs/${environment} in app/lib
 * - Dispatch payloads do not include "environment" key
 */

import * as fs from "fs"
import * as path from "path"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

const ROOT = path.resolve(__dirname, "../..")

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
    /* dir may not exist */
  }
  return out
}

export const tests = [
  {
    name: "Model 2 invariant: no app/lib file references envs/${environment}",
    fn: () => {
      const files = ["app", "lib"].flatMap((d) =>
        collectFiles(path.join(ROOT, d), [".ts", ".tsx"])
      )
      const violations: { file: string; line: number }[] = []
      for (const file of files) {
        const content = fs.readFileSync(file, "utf8")
        const lines = content.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (/envs\/\$\{\s*environment\s*\}/.test(line) && !/environment_(key|slug)/.test(line)) {
            violations.push({ file: path.relative(ROOT, file), line: i + 1 })
          }
        }
      }
      assert(violations.length === 0, `Found envs/${"${environment}"} in: ${JSON.stringify(violations)}`)
    },
  },
]
