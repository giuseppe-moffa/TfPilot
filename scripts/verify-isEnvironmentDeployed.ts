/**
 * Manual verification: isEnvironmentDeployed output.
 * Run: npx tsx scripts/verify-isEnvironmentDeployed.ts
 *
 * With real GitHub token:
 *   GITHUB_TOKEN=xxx REPO=owner/repo npx tsx scripts/verify-isEnvironmentDeployed.ts
 */

import { isEnvironmentDeployed } from "@/lib/environments/isEnvironmentDeployed"

async function main() {
  const token = process.env.GITHUB_TOKEN ?? "token"
  const repo = process.env.REPO ?? "owner/repo"

  if (token === "token" || repo === "owner/repo") {
    const mockFetcher = async (path: string) => {
      if (path.includes("/pulls")) return { ok: true, status: 200, json: () => Promise.resolve([]) } as Response
      if (path.includes("/contents/")) return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response
      if (path.includes("/repos/owner/repo") && !path.includes("/contents/"))
        return { ok: true, status: 200, json: () => Promise.resolve({ default_branch: "main" }) } as Response
      return { ok: false, status: 404, json: () => Promise.resolve({}) } as Response
    }
    const [owner, repoName] = repo.split("/")
    const mockFetcherWithRepo = async (path: string) => {
      if (path.includes(`/repos/${owner}/${repoName}`)) {
        if (path.includes("/pulls")) return { ok: true, status: 200, json: () => Promise.resolve([]) } as Response
        if (path.includes("/contents/")) return { ok: true, status: 200, json: () => Promise.resolve({}) } as Response
        return { ok: true, status: 200, json: () => Promise.resolve({ default_branch: "main" }) } as Response
      }
      return { ok: false, status: 404, json: () => Promise.resolve({}) } as Response
    }
    const result = await isEnvironmentDeployed(
      token,
      {
        environment_id: "env_1",
        environment_key: "dev",
        environment_slug: "ai-agent",
        repo_full_name: repo,
      },
      mockFetcherWithRepo
    )
    console.log("Example output (mock — deployed, no open PR):")
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const result = await isEnvironmentDeployed(token, {
    environment_id: "env_1",
    environment_key: "dev",
    environment_slug: "ai-agent",
    repo_full_name: repo,
  })
  console.log("Real GitHub output:")
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
