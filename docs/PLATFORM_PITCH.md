
# TfPilot — Platform Overview & Competitive Positioning

## Executive Summary
TfPilot is an internal developer platform (IDP) designed to make Terraform-driven infrastructure **safe, deterministic, and developer-friendly** at scale.  
It combines a strict control-plane architecture with Git-native workflows to give teams the flexibility of Terraform without the operational chaos that typically follows.

TfPilot’s core philosophy is simple:

**Infrastructure changes should be requested, reviewed, executed, and audited through a deterministic platform—not ad‑hoc Terraform commands.**

This makes TfPilot particularly powerful for engineering teams operating multiple projects, workspaces, and environments where infrastructure reliability and governance are critical.

---

# Key Strengths of TfPilot

## 1. Deterministic Infrastructure Control Plane
Most Terraform platforms still allow engineers to run arbitrary Terraform commands.

TfPilot enforces a strict invariant:

- Terraform **only runs in controlled pipelines**
- Every infrastructure change originates from a **request**
- Requests become **PRs**
- Pipelines perform **plan/apply**
- Results are **indexed and audited**

This eliminates:

- state drift caused by manual CLI usage
- inconsistent infrastructure behavior
- hidden changes outside platform control

Result: **Infrastructure becomes deterministic and auditable.**

---

## 2. Workspace‑First Architecture
TfPilot uses a clean hierarchy:

```
org → project → workspace → request → runs
```

Each workspace represents:

- a Terraform root
- a state boundary
- a deployable unit

This prevents the most common Terraform failure mode:

**giant shared state files.**

Workspaces isolate infrastructure while still allowing large‑scale orchestration.

---

## 3. Template‑Driven Infrastructure
TfPilot introduces **Workspace Templates** stored in S3.

Templates define:

- modules
- configuration structure
- allowed inputs
- variable schema

Benefits:

- engineers do not write Terraform
- infrastructure remains standardized
- teams scale safely

Templates enable infrastructure to behave like **a product catalogue instead of raw code**.

---

## 4. Request‑Driven Infrastructure Changes
Instead of editing Terraform directly, engineers:

1. create a request
2. select a template
3. provide inputs
4. submit

TfPilot then:

- generates Terraform
- opens a PR
- runs CI pipelines
- records results

This approach makes infrastructure behave similarly to **a change management system for cloud resources.**

---

## 5. Strong Invariant‑Driven Architecture
TfPilot enforces platform invariants such as:

- lifecycle derived from facts only
- no mutable state transitions
- deterministic run indexing
- idempotent execution
- strict audit trail

This architecture makes the platform extremely resilient and predictable compared with typical Terraform automation systems.

---

## 6. Git‑Native Execution Model
TfPilot integrates directly with Git workflows:

- PR-based changes
- CI/CD plan and apply
- GitHub Actions integration
- run indexing and correlation

This aligns infrastructure with the same workflows engineers already use for code.

---

## 7. Full Observability of Infrastructure Activity
TfPilot provides visibility into:

- requests
- runs
- drift detection
- audit logs
- workspace activity timelines

Teams gain operational insight that raw Terraform workflows cannot provide.

---

# Comparison with Competing Platforms

| Feature | TfPilot | Terraform Cloud | env0 | Atlantis |
|--------|--------|----------------|------|---------|
| Workspace isolation | Strong | Moderate | Moderate | Weak |
| Template‑driven infra | Yes | Partial | Yes | No |
| Deterministic request model | Yes | Limited | Limited | No |
| Strict execution control | Yes | Partial | Partial | No |
| Git-native workflow | Yes | Yes | Yes | Yes |
| Drift visibility | Built‑in | Limited | Limited | Minimal |
| Platform invariants | Strong | Weak | Moderate | None |
| Custom platform flexibility | Very High | Low | Medium | Medium |

---

# Why TfPilot Stands Out

Most Terraform platforms solve **automation**.

TfPilot solves **infrastructure governance at scale**.

Key differentiators:

- deterministic infrastructure lifecycle
- workspace‑first architecture
- template‑driven provisioning
- request‑based infrastructure changes
- strict auditability
- Git‑native workflows
- platform invariants that prevent infrastructure chaos

The result is a platform that can scale to **hundreds or thousands of workspaces without Terraform becoming unmanageable.**

---

# Vision

TfPilot aims to become a full internal developer platform where engineers can:

- discover infrastructure through catalogues
- provision infrastructure safely through templates
- manage environments through workspaces
- track infrastructure lifecycle through requests and runs

The long‑term vision is a system where infrastructure behaves like a **product platform rather than a collection of scripts.**

---

# Future platform capabilities

The roadmap evolves TfPilot from a deterministic Terraform control plane into a full internal developer platform via:

- **Variable Sets** — reusable config and secret injection (org/project/workspace).
- **Policy Evaluation** — governance stage before approval/apply.
- **Cost Governance** — plan-derived cost guardrails and approval requirements.
- **Workspace Runs Projection** — workspace-level observability and analytics (projection only).
- **Enhanced Workspace Templates** — richer composable infrastructure stacks (TfPilot already has Workspace Templates; future work expands them).
- **Workspace Dashboard / Impact Graph** — operational view and dependency visibility per workspace.
- **Platform metadata layer** — workspace metadata as a first-class control-plane primitive (not just tags): one authoritative model per workspace. Unlocks impact graph, blast radius, change intelligence, ownership routing, cost attribution, change sets, risk scoring, platform dashboards. If you add only one major primitive next, make it this.
- **Deployment decision record** — unified approval object above policy, cost, and impact. One record before apply: what is changing, who approved, what policy/cost/impact said, risk level, safe to apply. Decision-centric; answers “why was this allowed to deploy?” With workspace metadata, impact-aware changes, change sets, and this, TfPilot becomes a real infrastructure change-control system (9.8/10).

TfPilot already has Workspace Templates; future work expands them into richer composable infrastructure stacks. Terminology: use **Workspace Templates**, not "Environment Templates"; the workspace is the environment unit.

#### Impact-Aware Infrastructure Changes

TfPilot aims to move beyond Terraform automation toward **infrastructure change intelligence**. Future versions may show: infrastructure dependency graphs; affected services; team ownership; risk classification; cost impact. This positions the platform as a differentiator from traditional Terraform platforms that offer plan output without operational context.

#### Opinionated Workspace Templates

Workspace Templates may evolve into composable stacks that enforce platform standards while allowing safe customization (e.g. controlled subcomponents, required/fixed/hidden/configurable building blocks).

#### Platform metadata layer (first-class primitive)

Workspace metadata as a **first-class control-plane primitive** — not just tags; a real platform-owned metadata layer. One authoritative table per workspace: `workspace_metadata` (workspace_id, owner_team, service, lifecycle_stage, business_criticality, system_tier, cloud_account_id). Dependencies: store as IDs for now; evolve to table `workspace_dependencies` (workspace_id, depends_on_workspace_id) for graph queries, indexing, and joins. Without it, impact-aware changes, ownership routing, cost attribution, dependency graph, change sets, risk scoring, and dashboards stay fragmented; with it, they all attach to the workspace. The architecture already centers on the workspace as Terraform root and state boundary — so this is the natural next layer, not a bolt-on. It is where a Terraform platform becomes an infrastructure intelligence platform (who owns this? what service? how critical? what does it depend on? what will this change affect?). Relatively low effort; many future features depend on it. **If you add only one major primitive next, make it workspace metadata first-class.**

#### Deployment decision record

A **unified approval object** above policy, cost, and impact — not just “PR approved, plan passed, policy passed,” but a real deployment decision record. Before apply, one object answers: what is changing; who approved it; what policy/cost/impact said; what risk level; whether it is safe to apply. Conceptual: `deployment_decision` (request_id, workspace_id, policy_result, cost_result, impact_result, approved_by, approval_reason, risk_level, created_at). The real control-plane question is **why was this allowed to deploy?** Example: “Decision: approved. Reason: policy passed; cost under threshold; no tier-1 blast radius; approved by platform owner.” Unlocks explainable approvals, audit-quality decision history, incident review, cleaner change sets, auto-approval/block rules. Most tools are run-, policy-, or PR-centric; TfPilot becomes **decision-centric**. With workspace metadata, impact-aware changes, change sets, and this record, TfPilot stops looking like a very good Terraform platform and starts looking like a real **infrastructure change-control system**. That is the 9.8/10 move.

#### Change Sets with deterministic rollback points

**Future capability.** Future TfPilot versions may package: the requested change; plan output; policy outcome; cost outcome; impact summary; execution history; rollback checkpoint. Most tools are run-centric; Change Sets make TfPilot decision-centric. This shifts the platform from "did apply succeed?" to "what exactly changed, what did it affect, and how do we revert safely?" — an advanced differentiator from traditional Terraform platforms.

---

# Conclusion

TfPilot combines strong platform architecture with Terraform flexibility.

Where most tools provide automation, TfPilot provides:

**control, safety, and scale.**

For organizations managing complex infrastructure environments, this architecture offers a path to operate Terraform with the same reliability expected from modern software platforms.
