export type MockPullRequest = {
  url: string
  number: number
  branch: string
  status: "open" | "closed" | "merged"
  title: string
  files: Array<{ path: string; diff: string }>
  planOutput: string
}

export async function createDraftPullRequest({
  requestId,
  module,
}: {
  requestId: string
  module?: string
}): Promise<MockPullRequest> {
  const branch = `req-${requestId}`
  const number = Math.floor(Math.random() * 800) + 200
  const title = `chore: request ${requestId} (${module ?? "infra change"})`
  const files = [
    { path: `infra/${branch}/main.tf`, diff: `+ resource "aws_null_resource" "${branch}" {}` },
  ]
  const planOutput = `Plan for ${branch}:\n+ ${module ?? "aws_null_resource.default"}`
  return {
    url: `https://github.com/infraforge/infraforge-iac/pull/${number}`,
    number,
    branch,
    status: "open",
    title,
    files,
    planOutput,
  }
}

export async function triggerPlanWorkflow(_branch: string) {
  // mock hook; real integration would dispatch a GitHub workflow
  return true
}
