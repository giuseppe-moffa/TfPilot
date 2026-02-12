# Plan: Single source of truth for projects/envs

1) Registry helpers

- Update `tfplan-ui/config/infra-repos.ts`: add `listProjects()` and `listEnvironments(project)` derived from registry keys (no hardcoding).

2) UI selectors

- Replace static project/env arrays in:
- `app/requests/new/page.tsx`
- `components/agent-chat.tsx`
- `components/project-selector.tsx`
- `components/env-selector.tsx`
with `listProjects()` and `listEnvironments(selectedProject)`.

3) Remove legacy env/project references

- Search for analytics/staging/test and remove unless present in registry (check `/api/modules`, `/api/requests`, assistant prompts).

4) Backend validation

- In `POST /api/requests`, call `resolveInfraRepo(project, environment)`; if missing, return 400.

5) Timeline / request table

- Ensure displays use stored `project`, `environment`, `targetRepo`, `targetEnvPath` without fallback to legacy names.

6) Assistant context

- When building system context, inject available projects/envs from registry (no “analytics”).