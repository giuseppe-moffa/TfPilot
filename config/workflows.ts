export const PLAN_WORKFLOW = process.env.GITHUB_PLAN_WORKFLOW ?? "plan.yml"
export const APPLY_WORKFLOW = process.env.GITHUB_APPLY_WORKFLOW ?? "apply.yml"
export const DESTROY_WORKFLOW = process.env.GITHUB_DESTROY_WORKFLOW ?? "destroy.yml"
export const CLEANUP_WORKFLOW = process.env.GITHUB_CLEANUP_WORKFLOW ?? "cleanup.yml"