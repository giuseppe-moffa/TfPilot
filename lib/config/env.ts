type Env = {
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  AUTH_SECRET: string
  OPENAI_API_KEY: string
  OPENAI_MODEL: string
  GITHUB_DEFAULT_OWNER: string
  GITHUB_DEFAULT_BASE_BRANCH: string
  GITHUB_PLAN_WORKFLOW_FILE: string
  GITHUB_APPLY_WORKFLOW_FILE: string
  GITHUB_DESTROY_WORKFLOW_FILE: string
  GITHUB_CLEANUP_WORKFLOW_FILE: string
  TFPILOT_DEFAULT_REGION: string
  TFPILOT_APP_NAME: string
  TFPILOT_REQUESTS_BUCKET: string
  TFPILOT_CHAT_LOGS_BUCKET: string
  TFPILOT_TEMPLATES_BUCKET: string
  TFPILOT_ALLOWED_LOGINS: string[]
  TFPILOT_PROD_ALLOWED_USERS: string[]
  TFPILOT_DESTROY_PROD_ALLOWED_USERS: string[]
  TFPILOT_ADMINS: string[]
  TFPILOT_APPROVERS: string[]
  TFPILOT_ALLOWED_REGIONS: string[]
  TFPILOT_ADMIN_EMAILS: string[]
  TFPILOT_EMAIL_FROM: string
  GITHUB_WEBHOOK_SECRET: string
  /** Optional: token for webhook-triggered cleanup dispatch (no user session). */
  GITHUB_SERVER_TOKEN: string
}

// Check if we're in Next.js build phase (when env vars aren't available)
// During Docker build, these won't be set, so we provide placeholders
// At runtime in ECS, env vars will be injected from SSM Parameter Store
const isBuildTime = !process.env.VERCEL && 
                    !process.env.AWS_EXECUTION_ENV && 
                    !process.env.ECS_CONTAINER_METADATA_URI

function required(name: keyof Env, fallback?: string) {
  const val = process.env[name]
  if (val) return val
  if (fallback !== undefined) return fallback
  // During build time, provide placeholder values (they'll be available at runtime via SSM)
  // This allows Next.js to build the app without requiring all env vars at build time
  if (isBuildTime) {
    return `__BUILD_PLACEHOLDER_${name}__`
  }
  throw new Error(`Missing ${name}`)
}

function list(name: keyof Env, fallback: string[] = []) {
  const val = process.env[name]
  if (!val) return fallback
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export const env: Env = {
  GITHUB_CLIENT_ID: required("GITHUB_CLIENT_ID"),
  GITHUB_CLIENT_SECRET: required("GITHUB_CLIENT_SECRET"),
  AUTH_SECRET: required("AUTH_SECRET"),
  OPENAI_API_KEY: required("OPENAI_API_KEY"),
  OPENAI_MODEL: required("OPENAI_MODEL", "gpt-4o-mini"),
  GITHUB_DEFAULT_OWNER: required("GITHUB_DEFAULT_OWNER", "giuseppe-moffa"),
  GITHUB_DEFAULT_BASE_BRANCH: required("GITHUB_DEFAULT_BASE_BRANCH", "main"),
  GITHUB_PLAN_WORKFLOW_FILE: required("GITHUB_PLAN_WORKFLOW_FILE", "plan.yml"),
  GITHUB_APPLY_WORKFLOW_FILE: required("GITHUB_APPLY_WORKFLOW_FILE", "apply.yml"),
  GITHUB_DESTROY_WORKFLOW_FILE: required("GITHUB_DESTROY_WORKFLOW_FILE", "destroy.yml"),
  GITHUB_CLEANUP_WORKFLOW_FILE: required("GITHUB_CLEANUP_WORKFLOW_FILE", "cleanup.yml"),
  TFPILOT_DEFAULT_REGION: required("TFPILOT_DEFAULT_REGION", "eu-west-2"),
  TFPILOT_APP_NAME: required("TFPILOT_APP_NAME", "TfPilot"),
  TFPILOT_REQUESTS_BUCKET: required("TFPILOT_REQUESTS_BUCKET"),
  TFPILOT_CHAT_LOGS_BUCKET: required("TFPILOT_CHAT_LOGS_BUCKET"),
  TFPILOT_TEMPLATES_BUCKET: required("TFPILOT_TEMPLATES_BUCKET"),
  TFPILOT_ALLOWED_LOGINS: list("TFPILOT_ALLOWED_LOGINS", []),
  TFPILOT_PROD_ALLOWED_USERS: list("TFPILOT_PROD_ALLOWED_USERS", []),
  TFPILOT_DESTROY_PROD_ALLOWED_USERS: list("TFPILOT_DESTROY_PROD_ALLOWED_USERS", []),
  TFPILOT_ADMINS: list("TFPILOT_ADMINS", []),
  TFPILOT_APPROVERS: list("TFPILOT_APPROVERS", []),
  TFPILOT_ALLOWED_REGIONS: list("TFPILOT_ALLOWED_REGIONS", []),
  TFPILOT_ADMIN_EMAILS: list("TFPILOT_ADMIN_EMAILS", []),
  TFPILOT_EMAIL_FROM: required("TFPILOT_EMAIL_FROM", "noreply@tfpilot.local"),
  GITHUB_WEBHOOK_SECRET: required("GITHUB_WEBHOOK_SECRET", ""),
  GITHUB_SERVER_TOKEN: required("GITHUB_SERVER_TOKEN", ""),
}

let logged = false
export function logEnvDebug() {
  if (logged || process.env.NODE_ENV === "production") return
  logged = true
  console.log("[TfPilot ENV CHECK]", {
    githubOwner: env.GITHUB_DEFAULT_OWNER,
    baseBranch: env.GITHUB_DEFAULT_BASE_BRANCH,
    workflows: {
      plan: env.GITHUB_PLAN_WORKFLOW_FILE,
      apply: env.GITHUB_APPLY_WORKFLOW_FILE,
    },
    openaiModel: env.OPENAI_MODEL,
    region: env.TFPILOT_DEFAULT_REGION,
    appName: env.TFPILOT_APP_NAME,
  })
}
