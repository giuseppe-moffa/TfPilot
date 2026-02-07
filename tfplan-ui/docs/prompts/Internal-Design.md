# InfraForge — Internal Design Document

## System Overview

InfraForge is an agentic infrastructure automation platform where multiple AI agents collaborate under a central controller. The architecture follows a **supervisor-first** pattern: a Master Superprompt (acting as a supervisor agent) receives user goals and delegates tasks to specialized agents. The Terraform Generator Agent handles creating new infrastructure code, the Terraform Modules Agent manages reusable component libraries, and the GitHub Worker Agent automates code repository tasks. Agents operate with awareness of the real infrastructure state (Terraform state, cloud environment) so that changes are applied consistently. This design resembles a distributed engineering team, where each agent has a domain expertise, and the Master enforces a research-first, safety-first doctrine.

## Terraform Generation Workflow

The Terraform Generator Agent follows a structured workflow to produce infrastructure code:

1. **Receive request:** The agent gets a high-level goal for infrastructure changes (e.g., “provision a VPC”).
2. **Context gathering:** Retrieve the current Terraform state and environment (e.g. AWS account, region) to understand existing resources.
3. **Plan:** Determine what new resources or changes are needed.
4. **Code generation:** Write Terraform `.tf` files (including `variables.tf` and `outputs.tf`) implementing the plan. Use existing modules or call the Modules Agent if available.
5. **Validation:** Run `terraform fmt` and `terraform validate` to check syntax.
6. **Plan execution:** Execute `terraform plan` via the Terraform CLI to generate a change plan.
7. **Output:** Provide the generated Terraform code and the plan diff to the controller or user. Abort if errors occur.

This ensures the agent always plans with real context and verifies its output before proceeding.

## GitHub PR and CI Workflow

The GitHub integration follows these steps:

1. **Feature branch:** The GitHub Worker creates a new branch and commits the Terraform code to it.
2. **Pull request:** The agent opens a PR against `main`, including a title, description, and context (e.g. request ID).
3. **CI on PR:** The CI/CD pipeline (e.g. GitHub Actions) runs automatically on each commit to the PR. Typically it performs `terraform plan` and any tests.
4. **Review and feedback:** Results (plan or test output) are posted as PR comments. Human reviews and approvals are required.
5. **Merge & apply:** After all checks pass and approvals, merging the PR triggers `terraform apply` (via CI) to enact the changes.
6. **Post-merge:** The agent verifies deployment success and updates the PR status or comments with final results.

Using GitOps practices ensures every infrastructure change is reviewed and automated.

## STS AssumeRole Model

InfraForge employs AWS STS AssumeRole for secure, ephemeral credentials. For example, GitHub Actions workflows use OIDC to obtain tokens and assume IAM roles with branch-specific scopes. AWS IAM trust policies are configured to allow only this mechanism: they define GitHub’s OIDC provider as a trusted source and restrict role assumption by repository and branch. Similarly, any service running as an agent can assume a pre-defined role to perform actions. This model ensures credentials are short-lived and constrained by policy.

## Multi-Tenant and RBAC Design

InfraForge supports multiple tenants or projects with strict access controls. Each tenant’s resources are isolated (e.g. by AWS account, VPC, or workspace). User identities (via SSO or GitHub accounts) are mapped to IAM or Vault roles; agents enforce these roles so that actions are scoped per-user/project. The OIDC trust policy ensures only authorized repos/branches can assume tenant-specific roles. All agent actions are logged and auditable, maintaining a clear RBAC model.

## Security Model

InfraForge’s security model is “zero trust” and audit-driven. Agents authenticate via OIDC or Vault-issued tokens; no static credentials are used. All secrets (API keys, database passwords) are stored in Vault or GitHub Secrets, and never embedded in prompts or code. Agent actions are authorized according to corporate policies: for example, policy engines may enforce “no public S3 buckets” or least-privilege IAM before any change. Every action is logged. HashiCorp’s secure AI framework also prescribes using Vault and JWT tokens for agent identity.

## Best Practices

- **Research-First:** Always gather information about existing infrastructure and requirements before making changes.
- **Plan with context:** Use the real Terraform state and environment to guide code generation.
- **Automate validation:** Run `terraform fmt`, `terraform validate`, and CI checks on every change to enforce quality.
- **Modular design:** Use and contribute to reusable Terraform modules, designing each module for single responsibility and reusability.
- **CI/GitOps workflow:** Follow a GitOps pattern (plan on PR, apply on merge) with automated testing.
- **Security-first:** Enforce policies via IAM/Vault and audit everything.
- **Continuous improvement:** After each cycle, perform a retrospective and update agent rules and modules accordingly.

## Design Rationale and Constraints

We adopted a multi-agent architecture because it mirrors real-world engineering teams: distributed yet coordinated. Each agent specializes in one aspect (code gen, modules, SCM), allowing concurrent progress and modular updates. Centralizing rules in the Master Superprompt ensures consistency and safety. Using Terraform as the language provides transparency and control, but imposes structure on generated code. Agents must incorporate Terraform’s idempotence and planning; this helps mitigate AI hallucinations by cross-checking with `terraform plan`. We designed for extensibility: new agents (e.g. for Kubernetes or Helm) can be added under the same orchestration framework.

Key constraints include ensuring **context-awareness** (agents cannot assume an empty environment) and **auditability** (every change must be reviewed). Handling multiple tenants increases IAM complexity, but Vault and OIDC address that. Agents are also constrained by infrastructure limits (large state size, API rate limits), so caching and incremental strategies are employed. Finally, all design choices are biased toward safety and traceability, accepting additional complexity to ensure trust and compliance.