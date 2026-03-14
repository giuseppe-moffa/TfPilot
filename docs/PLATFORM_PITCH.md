
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

# Conclusion

TfPilot combines strong platform architecture with Terraform flexibility.

Where most tools provide automation, TfPilot provides:

**control, safety, and scale.**

For organizations managing complex infrastructure environments, this architecture offers a path to operate Terraform with the same reliability expected from modern software platforms.
