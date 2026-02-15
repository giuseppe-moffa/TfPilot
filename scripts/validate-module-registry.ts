import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createRequire } from "module"
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { moduleRegistry }: { moduleRegistry: Array<any> } = require("../config/module-registry")
type ModuleRegistryEntry = (typeof moduleRegistry)[number]

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type Vars = {
  required: Set<string>
  optional: Set<string>
}

async function parseVariablesTf(filePath: string): Promise<Vars> {
  const vars: Vars = { required: new Set(), optional: new Set() }
  const content = await readFile(filePath, "utf8")

  const regex = /variable\s+"([^"]+)"\s*{([\s\S]*?)}\s*/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const name = match[1]
    const body = match[2]
    const hasDefault = /default\s*=/.test(body)
    if (hasDefault) vars.optional.add(name)
    else vars.required.add(name)
  }

  return vars
}

async function findModuleVars(moduleName: string): Promise<Vars | null> {
  const moduleRoots = [
    path.resolve(__dirname, "..", "..", "..", "core-terraform", "modules"),
    path.resolve(__dirname, "..", "..", "..", "payments-terraform", "modules"),
  ]
  for (const root of moduleRoots) {
    const modPath = path.join(root, moduleName)
    try {
      const st = await stat(modPath)
      if (!st.isDirectory()) continue
      const varsPath = path.join(modPath, "variables.tf")
      const varsStat = await stat(varsPath)
      if (!varsStat.isFile()) continue
      return await parseVariablesTf(varsPath)
    } catch {
      continue
    }
  }
  return null
}

function diffSets(name: string, registrySet: Set<string>, tfRequired: Set<string>, tfOptional: Set<string>) {
  const tfAll = new Set([...tfRequired, ...tfOptional])
  const missingInTf = [...registrySet].filter((k) => !tfAll.has(k))
  const missingInRegistry = [...tfAll].filter((k) => !registrySet.has(k))
  return { name, missingInTf, missingInRegistry }
}

async function main() {
  const errors: string[] = []
  for (const entry of moduleRegistry) {
    const vars = await findModuleVars(entry.type)
    if (!vars) {
      errors.push(`Module ${entry.type}: variables.tf not found in core-terraform or payments-terraform`)
      continue
    }

    const requiredFields = new Set<string>((entry.fields ?? []).filter((f: any) => f.required).map((f: any) => f.name))
    const allFields = new Set<string>((entry.fields ?? []).map((f: any) => f.name))

    const reqDiff = diffSets(`${entry.type} required`, requiredFields, vars.required, vars.optional)
    if (reqDiff.missingInTf.length > 0) {
      errors.push(`${entry.type}: required in registry but not in variables.tf -> ${reqDiff.missingInTf.join(", ")}`)
    }

    const registryMissing = [...vars.required].filter((k) => !allFields.has(k))
    if (registryMissing.length > 0) {
      errors.push(`${entry.type}: variables.tf has fields not in registry -> ${registryMissing.join(", ")}`)
    }
  }

  if (errors.length > 0) {
    console.error("Registry validation FAILED:")
    for (const e of errors) console.error(" -", e)
    process.exit(1)
  } else {
    console.log("Registry validation OK")
  }
}

void main()
