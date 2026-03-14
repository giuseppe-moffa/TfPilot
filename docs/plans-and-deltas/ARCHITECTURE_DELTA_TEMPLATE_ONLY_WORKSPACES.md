# Architecture Delta: Template-Only Workspaces

## Status

Design delta. Pending approval. No implementation started.

**Scope:** Remove blank/minimal workspace creation. Require all workspaces to be created from a template that defines baseline modules. Introduce parameterized workspace templates (template inputs). Deploy a **fresh-start template subsystem** with S3 as the only canonical source. No legacy compatibility required. Requests remain the sole mechanism for adding or modifying infrastructure after creation.

---

## 1. Context

TfPilot currently allows creating a workspace with a **blank template** (`modules: []`). This introduces a special-case path:

- Blank workspace creation
- Optional resources added later via requests
- Additional conditional logic in skeleton generation

This is inconsistent with platforms like **env0**, which requires every environment to be created from a template that defines the baseline infrastructure.

---

## 2. Problem

Blank workspaces introduce:

| Issue | Impact |
|-------|--------|
| **Poor UX** | Users create empty environments with no guidance |
| **Branching logic** | Special-case paths in workspace creation |
| **Inconsistent skeleton** | Different code paths for blank vs templated |
| **Unnecessary UI states** | Extra conditional UI and empty states |
| **Code complexity** | Dual-path model increases maintenance cost |

The system currently supports both:

1. **Template-based workspace creation** — workspace gets baseline modules from template
2. **Blank workspace creation** — workspace gets only skeleton (backend.tf, providers.tf, .gitkeep)

This dual-path model increases complexity and dilutes product opinion.

---

## 3. Goal

Adopt a **template-first workspace model** with **parameterized workspace templates**:

- Every workspace **must** be created from a template
- Templates define the baseline modules for the workspace
- Templates may define **configurable inputs** (e.g. `service_name`, `cpu`, `memory`) that users fill during workspace creation
- Template inputs populate Terraform variables in the generated workspace skeleton
- Example templates: S3 Bucket, ECR Repository, ECS Service, Lambda Service, VPC + Networking
- Later infrastructure changes occur **only** through the request system

---

## 4. Target Model

### Workspace creation flow

```
Select Template
  → Configure Template Inputs
  → Preview Infrastructure
  → Configure Workspace (name, environment)
  → Create Workspace
  → Generate skeleton → Trigger preview run → terraform plan → Store plan → Show plan in UI
  → User reviews plan
  → Deploy PR (deploy run)
  → Merge
  → Workspace active
```

Users see a **Terraform plan in the workspace UI before clicking Deploy** (preview run).

### Invariant

**Requests remain the only mechanism** to add or modify infrastructure after workspace creation.

---

## Workspace Run model

A unified **Workspace Run** system (inspired by env0) manages all Terraform plan/apply executions. Users see a **Terraform plan in the workspace UI before clicking Deploy** by virtue of a **preview run** triggered on workspace creation.

### Run types

| Type | When | Behaviour |
|------|------|-----------|
| **preview** | Immediately after workspace creation | Generate skeleton → trigger CI → terraform init + plan → store plan output; user sees plan before Deploy |
| **deploy** | User clicks Deploy | Create deploy run; terraform plan → user approves PR → terraform apply |
| **request** | Request plan/apply | Existing request plans recorded as request runs |
| **drift** | Drift detection | Drift check recorded as drift run |
| **destroy** | Workspace destroy | Destroy execution recorded as destroy run |

### Run record

Each run records:

| Field | Description |
|-------|-------------|
| `run_id` | Unique run identifier |
| `workspace_id` | Workspace this run belongs to |
| `type` | `preview` \| `deploy` \| `request` \| `drift` \| `destroy` |
| `status` | Run status (see enum below) |
| `created_at` | When the run was created |

**Run status enum:**

| Status | Description |
|--------|-------------|
| `pending` | Run created; not yet started |
| `running` | Plan or apply in progress |
| `success` | Completed successfully |
| `failed` | Plan or apply failed |
| `cancelled` | Run was cancelled |

Each run may generate:

| Field | Description |
|-------|-------------|
| `plan_output` | Terraform plan stdout (or reference to S3) |
| `resource_summary` | Parsed summary; shape below |

**Resource summary schema:**

```ts
resource_summary: {
  add: number      // resources to add
  change: number   // resources to change
  destroy: number // resources to destroy
}
```

Enables consistent UI rendering (e.g. "Plan: 6 to add, 0 to change, 0 to destroy").

Apply runs (deploy, request apply) may also include:

| Field | Description |
|-------|-------------|
| `apply_status` | Outcome of apply |

### Run storage (S3)

Plan outputs stored in S3 under a single layout:

```
runs/<workspace_id>/<run_id>/plan.txt
```

Example: `runs/ws_abc123/run_xyz789/plan.txt`

All run types (preview, deploy, request, etc.) use this structure. Run metadata (run_id, workspace_id, type, status, created_at, resource_summary, apply_status) is stored in DB or S3 as needed for listing and UI.

### Preview run on workspace creation

**Workspace creation must trigger a preview run.** Flow:

```
Create Workspace
  → Generate workspace skeleton (commit to repo or temp)
  → Trigger preview run (e.g. CI workflow workspace-preview-plan.yml)
  → CI: terraform init + terraform plan
  → Store plan output to S3 (runs/<workspace_id>/<run_id>/plan.txt)
  → Create run record (type: preview)
  → Show plan in workspace UI
```

User can then **review the Terraform plan before clicking Deploy.**

### Deploy flow (deploy run)

Deploy creates a **deploy run**. Execution:

1. terraform plan (or reuse preview if still valid)
2. User approves PR
3. terraform apply

Deploy run record stores plan output and apply status.

### Request flow (request runs)

Existing request plans become **request runs**. No change to request lifecycle other than recording each plan/apply as a run. Enables unified run history in the UI.

### Workspace UI: plan and run history

Workspace page must include:

**Preview Plan section** (before user clicks Deploy):

- Plan summary
- Resource diff
- Resources to add / change / destroy

**Runs history section:**

- Preview run (from workspace creation)
- Deploy run(s)
- Request runs

This aligns TfPilot with env0 — plan visibility before Deploy and a single place to see all runs.

---

## Template Preview Before Creation

The single biggest UX improvement env0 does for templates: **show exactly what will be deployed before the user creates the workspace.**

Without preview, the flow is slow and opaque: Create → open PR → wait → see plan. With preview, users immediately understand what they are deploying.

| Step | User sees |
|------|-----------|
| 1 — Choose Template | Template cards (name, description, category) |
| 2 — Configure Inputs | Form generated from template inputs |
| 3 — **Preview Infrastructure** | Resources to be created; variables; module list |
| 4 — Create Workspace | Proceed with full context |

### What the preview shows

- **Modules** — Which baseline modules will be instantiated
- **Variables** — The configured template_inputs (resolved values)
- **Resources to be created** — Human-readable list derived from template modules (e.g. "ECR Repository", "ECS Service", "Application Load Balancer")

Example:

```
Resources to be created:
• ECR Repository
• ECS Service
• Application Load Balancer
• Security Group
```

### Implementation approach

**Simple version (recommended first):** Generate preview from template modules, not Terraform. Derive "Resources to be created" from `template.modules[].id` and module registry display names. No temporary workspace or backend. Very lightweight.

**Advanced version (later):** Run a real terraform plan preview before creation. Requires temporary workspace, temp backend, and cleanup. Heavier; defer until simple version proves sufficient.

### Why this matters

- **Trust** — User sees exactly what they are committing to before Create
- **Speed** — No "create and wait" cycle to understand the outcome
- **Alignment** — Matches env0 flow; platform feels professional

---

## Template Inputs

Templates may define **configurable inputs** — configuration variables that users fill during workspace creation. These inputs populate Terraform variables in the generated workspace skeleton.

**Example:** Template "ECS Service" with inputs:

- `service_name`, `cpu`, `memory`, `desired_count`

These values are written to `terraform.tfvars` and declared in `variables.tf`.

### Template schema (extended)

| Field | Description |
|-------|-------------|
| `id` | Template identifier |
| `name` | Display name |
| `version` | Semantic version (e.g. `1.0.0`); used for immutable template resolution |
| `modules` | Baseline modules — one or more required; non-empty |
| `inputs` | Array of input definitions |
| `description` | (Optional) Short description for UI catalogue |
| `category` | (Optional) Category for grouping (e.g. `compute`, `storage`, `networking`) |
| `icon` | (Optional) Icon identifier or URL for UI catalogue |
| `recommended` | (Optional) Boolean; mark as recommended in catalogue for new users |

### Template catalogue ordering

UI can order templates for better discovery (env0-style):

| Section | Source |
|---------|--------|
| **Recommended** | `recommended: true` |
| **Storage** | `category: "storage"` |
| **Compute** | `category: "compute"` |
| **Networking** | `category: "networking"` |

Templates without `category` appear in a catch-all or at the end.

### Module schema

Each module is an object with source, version, and config. Skeleton generation uses this to emit correct request files — no guesswork.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Module identifier (e.g. `s3_bucket`, `ecr_repo`) |
| `source` | string | Module source path (e.g. `tfpilot/modules/s3-bucket`) |
| `version` | string | Module version constraint (e.g. `1.0.0`, `~> 1.0`) |
| `config` | object | Request config; may reference template variables (e.g. `"${var.bucket_name}"`) |

**Example template document:**

```json
{
  "id": "ecs-service",
  "version": "1.0.0",
  "name": "ECS Service",
  "description": "Deploy an ECS service with ALB and ECR",
  "category": "compute",
  "icon": "ecs",
  "recommended": true,
  "modules": [
    {
      "id": "ecr_repo",
      "source": "tfpilot/modules/ecr-repo",
      "version": "1.0.0",
      "config": { "name": "${var.service_name}-repo" }
    },
    {
      "id": "ecs_service",
      "source": "tfpilot/modules/ecs-service",
      "version": "1.0.0",
      "config": {
        "service_name": "${var.service_name}",
        "cpu": "${var.cpu}",
        "memory": "${var.memory}"
      }
    }
  ],
  "inputs": [...]
}
```

### Input schema

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Variable identifier (e.g. `service_name`) |
| `label` | string | Display label for the form |
| `type` | `string` \| `number` \| `boolean` | Input type |
| `required` | boolean | Whether the user must provide a value |
| `default` | any | Default value when not provided |

### Skeleton generation

The **workspaceSkeleton** generator must produce:

- **variables.tf** — Terraform variable declarations derived from template `inputs`
- **terraform.tfvars** — Variable values from user-provided `inputs` (merged with defaults)

Existing outputs (backend.tf, providers.tf, versions.tf, tfpilot/base.tf, module request files) remain unchanged. Variables are injected so that module request files can reference them (e.g. `var.service_name`).

### Workspace storage

Workspaces store template provenance to prevent template updates from breaking existing workspaces:

| Field | Description |
|-------|-------------|
| `template_id` | Template used to create the workspace |
| `template_version` | Exact version resolved at creation (immutable) |
| `template_inputs` | User-provided input values at creation |

Skeleton generation and future operations resolve the template at `template_id` + `template_version`; template revisions do not affect existing workspaces.

---

## 5. Architectural Decision

**Blank/minimal templates are not supported.**

- **Workspace creation requires a template.** Every workspace must be created from a template; `template_id` is required.
- **Every template must define one or more baseline modules.** Templates with zero modules are invalid; blank or minimal templates are not allowed.
- **TfPilot will not support blank workspace creation in any form.** No escape hatch, no special-case "minimal" template, no `modules: []` allowance.

---

## Fresh-start template system

The new template system is a **clean subsystem** with no legacy compatibility requirements.

| Principle | Implication |
|-----------|-------------|
| **No backward compatibility** | Old template config (static files, environment-templates) is not preserved |
| **No dual-read** | No fallback that reads from both static config and S3 |
| **No fallback resolution** | Template resolution is S3-only; 404 if template does not exist |
| **No migration layer** | Old template definitions are not migrated; no compatibility shim |
| **Static config retired** | Static config templates are **removed** once the new system lands |

### Template storage

Use the existing **tfpilot-templates** S3 bucket. S3 is the only canonical template source.

**S3 layout:**

```
templates/workspaces/<templateId>/<version>.json   # Template document (id, name, version, modules, inputs)
templates/workspaces/index.json                  # Index: list of template IDs and latest versions (for UI listing)
```

Example: `templates/workspaces/ecs-service/1.0.0.json`, `templates/workspaces/ecs-service/1.1.0.json`.

- **Workspace creation resolves templates only from S3.** No static config or file-based resolution at runtime.
- **Template versioning:** Each template version is immutable. Workspaces pin `template_id` + `template_version` so template updates do not affect existing workspaces.

### Template versioning lifecycle

| Scenario | Behaviour |
|----------|-----------|
| Template v2 released | Existing workspaces stay on v1; no automatic upgrade |
| User wants upgrade | Explicit **Upgrade template** action in workspace UI; user selects new version |
| Deploy (create PR, apply) | Always uses pinned `template_id` + `template_version`; never latest |

- **Static config is not part of the final runtime model.** Config files such as `config/environment-templates.ts` (or equivalent) are deleted; they do not coexist with the new system.

---

## 6. Scope of Change

| Area | Change |
|------|--------|
| **Workspace creation API** | Reject requests without valid `template_id` + `template_version`; reject templates with empty `modules`. Remove blank fallback. Accept `template_inputs`; validate against template input schema. Store `template_id`, `template_version`, `template_inputs` on workspace. |
| **Workspace templates configuration** | Use tfpilot-templates S3 bucket. Layout: `templates/workspaces/<templateId>/<version>.json`, `templates/workspaces/index.json`. Seed versioned templates. Use expanded module schema (id, source, version, config). Each template must have one or more modules. Add metadata: description, category, icon, recommended. |
| **Template input schema** | Define input schema (key, label, type, required, default). Store in S3 template documents. |
| **workspaceSkeleton logic** | Remove `BLANK_TEMPLATE` / blank special case; all paths use template. Produce `variables.tf` and `terraform.tfvars` from template inputs. Resolve modules from expanded schema (id, source, version, config). |
| **UI workspace creation flow** | Require template selection. Add step: Configure Template Inputs — dynamically generate form from template `inputs`. Add step: **Preview Infrastructure** — show modules, variables, resources to be created (derived from template; no Terraform run). Remove "Blank" as an option entirely. |
| **Template selection UI** | Simplify; no conditional "blank vs template" branching |
| **Skeleton variable generation** | Generate `variables.tf` (variable declarations) and `terraform.tfvars` (values) from template inputs and user-provided `inputs`. |
| **Input validation** | Validate `template_inputs` against template schema at API boundary; reject invalid or missing required values. |
| **Workspace DB schema** | Add columns: `template_id`, `template_version`, `template_inputs` (JSON). Resolve templates from S3 at `template_id`/`template_version` for skeleton generation and operations. |
| **Workspace Runs** | Introduce run model: run_id, workspace_id, type (preview, deploy, request, drift, destroy), status, created_at; optional plan_output, resource_summary, apply_status. Run storage in S3: `runs/<workspace_id>/<run_id>/plan.txt`. |
| **Preview run** | Workspace creation triggers preview run: generate skeleton → CI runs terraform init + plan → store plan to S3 → create run record → show plan in workspace UI before user clicks Deploy. |
| **Deploy run** | Deploy creates a deploy run; plan → approve PR → apply; plan output and apply status stored. |
| **Request runs** | Existing request plans recorded as request runs; no change to request lifecycle. |
| **Workspace UI runs** | Workspace page: Preview Plan section (plan summary, diff, resources to add/change/destroy); Runs history (preview, deploy, request runs). |
| **Legacy removal** | Implementation may **delete** old static template config, blank/minimal special-case logic, and compatibility code related to legacy template resolution. No migration path required. |
| **Tests** | Update/remove tests asserting blank workspace behavior; add tests for template inputs validation and skeleton generation. |
| **Documentation** | Update glossary, API docs, onboarding |

---

## 7. Non-Goals

Do not change:

- Terraform execution model
- PR-driven infrastructure workflow (create → PR → plan → approve → merge → apply)
- Request lifecycle
- RBAC model
- Project/Workspace hierarchy
- Bootstrap vs deploy unification (separate delta)

---

## 8. Expected Benefits

| Benefit | Description |
|---------|-------------|
| **Simpler code paths** | Single path for workspace creation |
| **Simpler UI** | No blank vs template branching |
| **Stronger product opinion** | Templates guide users; no "empty shell" escape hatch |
| **Reusable infrastructure blueprints** | Templates with inputs become parameterized blueprints |
| **Better onboarding UX** | Users always start from a sensible baseline; inputs guide configuration |
| **Reduced post-creation requests** | Template inputs pre-populate common config; fewer follow-up changes |
| **Closer alignment with env0** | Industry-standard template-first model with template inputs |
| **Cleaner template system** | Templates are the single source of truth |
| **Template updates safe for existing workspaces** | Workspaces pin `template_id` + `template_version`; template revisions do not affect already-created workspaces |
| **Plan visibility before apply** | Preview run shows Terraform plan in UI before Deploy; deploy run records plan and apply — matches env0/Terraform Cloud expectations |
| **Preview before create** | User sees modules, variables, and resources to be created before Create — matches env0 flow; dramatically increases trust |

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| **Rollout sequencing** | Seed a set of real baseline templates into S3 **before** enabling the new workspace creation flow. Ensure template API/store is available at rollout time. |
| **Template availability** | If S3 template store is empty or unavailable, workspace creation fails cleanly (503 or 404). Document seed/bootstrap procedure for new deployments. |
| **Template schema validation complexity** | Strict validation against template input schema at API boundary; clear error messages for invalid or missing required inputs |

### Removal targets (no migration; delete)

- Old static template config (e.g. `config/environment-templates.ts`)
- `BLANK_TEMPLATE`, `tid === "blank"` in workspaceSkeleton
- Dual-read / fallback template resolution paths

---

## 10. Recommendation

**Proceed with a fresh-start template system.** A clean implementation is preferred because:

- **Lower complexity** — no dual-read, no fallback paths, no migration layer
- **Cleaner architecture** — S3 as single source of truth; static config retired
- **Faster implementation** — delete legacy code instead of maintaining compatibility
- **No live template data to preserve** — seed new templates into S3; no migration of existing template definitions

**TfPilot will not support blank workspace creation in any form.** Every workspace must be created from a template with one or more baseline modules. Introduce template inputs (key, label, type, required, default). Store all templates in S3. Generate `variables.tf` and `terraform.tfvars` from template inputs. Align with env0-style opinionated template-first creation.

---

## 11. Next Step

After this delta is approved:

Create an implementation plan:

**`IMPLEMENTATION_PLAN_TEMPLATE_ONLY_WORKSPACES.md`**

That plan will assume:

- **S3-first only** — no static config; no legacy template resolution
- **No legacy template compatibility** — delete old template config and blank/minimal logic
- **Seed before enable** — seed a set of real baseline templates into S3 **before** enabling the new workspace creation flow

Phases should include:

- Phase 1: tfpilot-templates S3 layout; seed versioned templates (each with one or more modules)
- Phase 2: Template input schema; delete old static template config
- Phase 3: API changes (require template_id + template_version; accept and validate template_inputs; resolve templates from S3; store template provenance on workspace)
- Phase 4: workspaceSkeleton simplification; delete BLANK_TEMPLATE; add variables.tf and terraform.tfvars generation
- Phase 5: UI updates (Configure Template Inputs step; Preview Infrastructure step; dynamic form generation)
- Phase 6: Workspace creation UI (end-to-end create from template)
- Phase 7: Workspace Runs + Preview Plan (run model; preview run on create; workspace-preview-plan.yml; UI Preview Plan + Runs history)
- Phase 8: Test updates
- Phase 9: Deploy run (plan stored under runs/; deploy run in history)
- Phase 10: Cleanup and documentation
