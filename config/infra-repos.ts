export type InfraRepo = {
  owner: string
  repo: string
  base: string
  envPath: string
}

const registry: Record<string, InfraRepo> = {
  "core/dev": {
    owner: "giuseppe-moffa",
    repo: "core-terraform",
    base: "main",
    envPath: "envs/dev",
  },
  "core/prod": {
    owner: "giuseppe-moffa",
    repo: "core-terraform",
    base: "main",
    envPath: "envs/prod",
  },
  "payments/dev": {
    owner: "giuseppe-moffa",
    repo: "payments-terraform",
    base: "main",
    envPath: "envs/dev",
  },
  "payments/prod": {
    owner: "giuseppe-moffa",
    repo: "payments-terraform",
    base: "main",
    envPath: "envs/prod",
  },
}

export function resolveInfraRepo(project: string, environment: string): InfraRepo | null {
  const key = `${project}/${environment}`
  return registry[key] ?? null
}

/**
 * Resolve infra repo by project_key + environment_key ONLY.
 * environment_slug MUST NOT influence repo selection (Model 2 contract).
 */
export function resolveInfraRepoByProjectAndEnvKey(
  project_key: string,
  environment_key: string
): InfraRepo | null {
  return resolveInfraRepo(project_key, environment_key)
}

export function listProjects(): string[] {
  const projects = new Set<string>()
  for (const key of Object.keys(registry)) {
    const [project] = key.split("/")
    projects.add(project)
  }
  return Array.from(projects)
}

export function listEnvironments(project: string): string[] {
  const envs = new Set<string>()
  for (const key of Object.keys(registry)) {
    const [proj, env] = key.split("/")
    if (proj === project) {
      envs.add(env)
    }
  }
  return Array.from(envs)
}
