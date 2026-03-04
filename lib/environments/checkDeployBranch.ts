/**
 * Deploy branch helpers for environment deploy validation.
 * Branch naming per deploy flow: deploy/<environment_key>/<environment_slug>
 */

/** Returns the deploy branch name for an environment. */
export function getDeployBranchName(environment_key: string, environment_slug: string): string {
  return `deploy/${environment_key}/${environment_slug}`
}
