# Environment Templates UI — Implementation Plan

## Overview

**Scope:** Add Environment Templates catalogue section and Create Environment flow per `docs/ARCHITECTURE_DELTA_ENV_TEMPLATES_UI.md`.

**Invariants (do not break):**
- Terraform only runs in GitHub Actions
- Model 2 env roots unchanged
- S3 request docs canonical; Postgres projection only
- Lifecycle derived from facts only
- Deployed detection via exact backend.tf existence

**Constraints:**
- UI-only changes; no backend API modifications
- Incremental steps; each step is independently shippable
- **Environments list page:** Match `app/requests/page.tsx` exactly (Card layout, header, search, filter bar with tabs + selects, table, skeleton, empty state, pagination)
- **Environment detail page:** Match `app/requests/[requestId]/page.tsx` styling (layout, skeleton, Cards, sections)
- **Create Environment wizard:** Match `app/requests/new/page.tsx` styling and functionality exactly (full-height wizard, step-based flow, template grid, ActionProgressDialog, etc.)

---

## Step 1 — Environment Templates section in catalogue

**File:** `app/catalogue/page.tsx`

**Implementation:**
- Add state: `envTemplates` (array), `envTemplatesSearch`, `envTemplatesLoading`, `envTemplatesError`, `envTemplates503` (boolean for 503 vs 500)
- Fetch `GET /api/environment-templates`. **Response is a raw array** — do NOT expect `{ templates: [...] }`; `res.json()` returns the array directly.
- If 401: set `notFound` (same as request templates; shared sign-in screen)
- If 503: set `envTemplates503 = true`, message per §4.1
- If 500: set error, show "Failed to load templates" + retry
- Add section header "Environment Templates" with short description
- **Each section has its own search input** — env templates get a separate search field; filter by label/id only
- Card layout matching request templates: `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`, `Card` with label, description truncation, modules count
- Empty states (see delta §4.1):
  - 503: "Environment templates are not initialized. Ask an admin to run the seed."
  - 200 empty array: "No enabled templates."
  - Filtered empty: "No templates match your search."
- Card CTA: "View" → `/catalogue/environments/[id]`

**Reference patterns:** Request templates section (lines 285–306: search, loading, empty, grid, cards). Use same Card/Input/Button components.

**Acceptance checks:**
- [ ] `/catalogue` shows two sections: Request Templates (existing) and Environment Templates
- [ ] Each section has its own search input; filtering in one does not affect the other
- [ ] Env templates fetch returns raw array; no wrapper expected
- [ ] 401 → "Sign in to browse templates" (shared with request templates)
- [ ] 503 → "Environment templates are not initialized. Ask an admin to run the seed."
- [ ] 200 empty array → "No enabled templates."
- [ ] Cards link to `/catalogue/environments/[id]`

**Cursor prompt:**
```
Add the Environment Templates section to app/catalogue/page.tsx. Follow docs/ARCHITECTURE_DELTA_ENV_TEMPLATES_UI.md and docs/ENV_TEMPLATES_UI_IMPLEMENTATION_PLAN.md Step 1.

- Fetch GET /api/environment-templates (response is raw array, no wrapper)
- Each section has its own search input; env templates section below Request Templates
- Use same card layout as request templates (Card, grid sm:grid-cols-2 lg:grid-cols-3)
- Handle 401 (set notFound), 503 (ENV_TEMPLATES_NOT_INITIALIZED message), 500 (retry)
- Empty states: 503 = seed message, 200 [] = "No enabled templates", filtered = "No templates match your search"
- Card CTA "View" links to /catalogue/environments/[id]
```

---

## Step 2 — Environment template detail page

**File:** `app/catalogue/environments/[id]/page.tsx` (new)

**Implementation:**
- Fetch `GET /api/environment-templates/[id]`
- If 401: full-page "Sign in to browse templates" + link to `/login` (match catalogue)
- If 404: "Template not found" + link back to `/catalogue`
- If 500: error message + retry
- Render:
  - Back link → `/catalogue`
  - Template label (h1)
  - Description (if present)
  - Modules table: columns `order`, `module`, `defaultConfig` (preview: collapsed or truncated JSON)
  - CTA: "Use this template" → `/environments/new?template_id=${id}` (query param is `template_id`, not `templateId`)

**Reference patterns:** `app/catalogue/[id]/page.tsx` (read-only view, Card layout, back button). Use `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell` from `@/components/ui/table`.

**Acceptance checks:**
- [ ] `/catalogue/environments/[id]` loads template, shows label, description, modules table
- [ ] "Use this template" links to `/environments/new?template_id=${id}`
- [ ] 401 → sign-in prompt; 404 → not found; 500 → retry

**Cursor prompt:**
```
Create app/catalogue/environments/[id]/page.tsx per docs/ARCHITECTURE_DELTA_ENV_TEMPLATES_UI.md and docs/ENV_TEMPLATES_UI_IMPLEMENTATION_PLAN.md Step 2.

- Fetch GET /api/environment-templates/[id]
- Render description, modules table (order, module, defaultConfig preview)
- CTA "Use this template" → /environments/new?template_id=${id} (use template_id, not templateId)
- Handle 401 (sign-in), 404 (not found), 500 (retry)
- Match layout/patterns from app/catalogue/[id]/page.tsx (Card, Table, Back link)
```

---

## Step 3 — Create Environment wizard (New Environment page)

**File:** `app/environments/new/page.tsx` (new)

**Styling & layout:** Match `app/requests/new/page.tsx` exactly:
- Root: `flex h-[calc(100vh-4rem)] flex-col bg-background`
- Header: `flex items-center justify-between gap-3 bg-background/80 px-4 py-3 backdrop-blur` with Back (→ `/environments`), title "New Environment"
- Content: `flex-1 p-4 overflow-auto` with `mx-auto max-w-4xl space-y-6`
- Each step: `Card className="rounded-lg border-0 bg-card p-6 shadow-sm space-y-4"`

**Step 1 — Template picker:**
- Same layout as New Request template step: search input (`Search` icon, `pl-9`), loading spinner, empty state
- First option: "Blank" (UI-only); when selected, omit `template_id` from POST
- Remaining options: fetch `GET /api/environment-templates` (raw array)
- Template grid: `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3` with clickable `button` cards (not Link) — same as New Request
- Card styling: `rounded-lg border px-4 py-3 text-left` with hover/selected states (`border-primary bg-primary/10 ring-1 ring-primary/20` when selected)
- Show label, description (line-clamp-2), optional badge
- Read preselection from `?template_id=...` on mount. **Preselect rule:** Only auto-advance to Step 2 if `template_id` exists in fetched list OR equals `blank`; otherwise show inline "Template not found" and stay on Step 1.

**Step 2 — Form:**
- Same structure as New Request env step: `Label` + `Input`/`Select` in grid
- Fields: `project_key` (Select from `listProjects()` — from `@/config/infra-repos`; used in `app/requests/new/page.tsx`). **Fallback:** If `listProjects` is unavailable, use a plain `Input` for `project_key` in v1.
- `environment_key` (Input, lowercase), `environment_slug` (Input)
- Use `FieldCard`-style blocks or equivalent (`rounded-lg bg-muted/50 dark:bg-muted/40 px-3 py-3`) for field grouping
- Back button to Step 1; Continue to Step 3 (review) or Submit

**Step 3 — Review & submit:**
- Summary of template + project / env key / slug
- Submit button; on click show `ActionProgressDialog` (same as New Request: "Creating environment…", steps like "Saving…" / "Opening bootstrap PR…")
- POST `/api/environments`; on 201 redirect to `/environments/[environment_id]`

**Error mapping:**
- 401 → full-page "Sign in to create environments" + link to `/login`
- 503 `ENV_TEMPLATES_NOT_INITIALIZED` → inline in Step 1: "Environment templates are not initialized. Ask an admin to run the seed."
- 400 `INVALID_ENV_TEMPLATE` → inline: "The selected template is not available (disabled or removed). Please choose another."
- 400 validation → inline errors from `errors` array

**Reference:** `app/requests/new/page.tsx` — copy layout, Card styling, step flow, ActionProgressDialog usage, FieldCard/input patterns.

**Acceptance checks:**
- [ ] Layout matches New Request: full-height wizard, header, Cards per step
- [ ] Step 1: Blank first, template grid with search; `?template_id=` preselection — only auto-advance if template_id in list or blank; otherwise "Template not found"
- [ ] Step 2: project_key (listProjects or plain Input fallback), environment_key, environment_slug; Back/Continue
- [ ] Step 3: summary, ActionProgressDialog on submit
- [ ] 201 → redirect to `/environments/[id]`; errors handled per spec

**Cursor prompt:**
```
Create app/environments/new/page.tsx. Match app/requests/new/page.tsx styling and functionality exactly.

- Layout: flex h-[calc(100vh-4rem)] flex-col; header with Back + "New Environment"; content mx-auto max-w-4xl
- Step 1: Template picker — Blank first, then GET /api/environment-templates (raw array). Same Card + grid as New Request. Search, loading. Preselect from ?template_id= — only auto-advance if template_id in fetched list or blank; else show "Template not found", stay on Step 1.
- Step 2: Form — project_key (Select from listProjects; fallback: plain Input if unavailable), environment_key, environment_slug. FieldCard-style fields, Back/Continue
- Step 3: Summary + Submit. Use ActionProgressDialog on submit (match New Request). POST /api/environments; redirect on 201.
- Errors: 401 → sign-in, 503 → seed message, 400 INVALID_ENV_TEMPLATE → inline
```

---

## Step 4 — Restyle Environments page to match Requests page

**File:** `app/environments/page.tsx`

**Scope guard:** No functional changes; CSS/layout only. Preserve existing query params (`project_key`, `include_archived`), filters, and sorting behavior.

**Implementation:** Match `app/requests/page.tsx` styling exactly.

**Layout:**
- Root: `space-y-4` (no `container max-w-4xl py-8`)
- Card: `Card className="pt-0"` (same as Requests)

**Header:**
- `rounded-t-lg py-6 flex flex-wrap items-center justify-between gap-4 px-6`
- Left: title `text-xl font-semibold leading-none`, description `text-sm text-muted-foreground mt-1`
- Right: **"New Environment"** button — `Button asChild size="lg"` with `Link href="/environments/new"` (mirrors "New Request" → `/requests/new`)

**Filter bar:** Match Requests exactly — same order and structure:
- `mb-4 flex flex-wrap items-center gap-3 mt-4 min-h-11 rounded-lg py-3`
- **Search:** `relative h-11 flex items-center`, `Search` icon `absolute left-2.5`, `Input` `h-11 w-72 shrink-0 pl-9 pr-3 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0` — search by project, key, slug, repo
- **Dataset mode tabs:** `role="tablist" aria-label="Dataset mode"` — `inline-flex h-11 items-stretch rounded-lg bg-muted/50 dark:bg-muted/40 p-1 gap-0`. Tabs: **Active** | **Archived** | **All** (parallel to Requests' Active/Drifted/Destroyed/All)
- **Env filter Select:** `all` | `dev` | `prod` — same SelectTrigger classes as Requests
- **Project filter Select:** `all` + options from `listProjects()`
- **Clear filters** button: `variant="ghost" h-11 px-4 text-muted-foreground hover:text-foreground`
- All SelectTrigger: `!h-11 min-w-[130px] rounded-md bg-muted/50 dark:bg-muted/40 px-3 text-sm ...` (copy exact classes from `app/requests/page.tsx`)

**Table:**
- Same Table structure: `Table`, `TableHeader`, `TableRow`, `TableHead`, `TableBody`, `TableCell`
- Add `SkeletonRow` component for loading (same as Requests: `TableRow` with 4–5 `TableCell` with `animate-pulse rounded bg-muted`)
- Loading state: render N skeleton rows instead of single Loader2 spinner
- Columns: Project, Key, Slug, Repo, Status, Created, (optional Last updated), View (icon button with `Eye`, `Tooltip`, `TooltipContent`)
- Row links: `Link href={/environments/${id}}` on ID or first cell; View uses `Button size="icon" variant="ghost"` with `Eye` icon

**Empty state:**
- Same as Requests: `FileSearch` icon (`h-12 w-12 text-muted-foreground/60`), centered message
- Message: "No environments yet. Start by creating a new environment." when list empty; "No environments match your filters." when filtered empty

**Pagination (if needed):**
- If env list can be large, add same pagination as Requests: "Showing X to Y of Z entries", prev/next, page number buttons
- Otherwise omit (envs list may stay small)

**Reference:** `app/requests/page.tsx` — copy Card structure, header layout, filter bar markup, SkeletonRow, Table, empty state, TooltipProvider.

**Filter logic:**
- Dataset tabs: Active = `!archived_at`, Archived = `archived_at`, All = no filter
- Search: filter by project_key, environment_key, environment_slug, repo_full_name (client-side or ensure API supports)
- Env filter: match environment_key (dev/prod)
- Project filter: match project_key

**Acceptance checks:**
- [ ] Layout matches Requests: Card pt-0, header with title + description + "New Environment" button (size lg)
- [ ] Filter bar: Search + dataset tabs (Active/Archived/All) + env Select + project Select + Clear filters — same structure and styling as Requests
- [ ] Filtering works correctly
- [ ] Table with SkeletonRow loading state
- [ ] Empty state with FileSearch icon
- [ ] View uses Eye icon + Tooltip
- [ ] "New Environment" links to `/environments/new`

**Cursor prompt:**
```
Restyle app/environments/page.tsx to match app/requests/page.tsx exactly. No functional changes; CSS/layout only. Preserve project_key, include_archived query params and filter behavior.

- Layout: space-y-4, Card pt-0
- Header: rounded-t-lg py-6 flex justify-between px-6. Title "Environments", description. "New Environment" Button asChild size="lg" Link to /environments/new
- Filter bar: Search (h-11 w-72 pl-9) + dataset tabs (Active | Archived | All, same tab structure as Requests) + env Select (all/dev/prod) + project Select + Clear filters. Copy exact SelectTrigger/tab classes from Requests.
- Table: SkeletonRow for loading; same Table structure. Columns: Project/Key/Slug, Repo, Status, Created, View (Eye icon + Tooltip)
- Empty state: FileSearch icon, "No environments yet. Start by creating a new environment." / "No environments match your filters."
```

---

## Step 5 — Restyle Environment detail page to match Request detail page

**File:** `app/environments/[id]/page.tsx`

**Scope guard:** No functional changes; CSS/layout only. Preserve existing query params, data fetch logic, and all actions (deploy, destroy, drift, activity).

**Implementation:** Match `app/requests/[requestId]/page.tsx` styling.

**Layout:**
- Root: `mx-auto max-w-7xl space-y-8` (replace `container max-w-2xl py-8`)
- Main content in `section` with `rounded-lg bg-card p-6 shadow-sm`

**Loading state:**
- Add `EnvironmentDetailSkeleton` component (parallel to `RequestDetailSkeleton`)
- Skeleton: header area with animated pulse placeholders, metadata grid, action buttons placeholder
- Replace single Loader2 with skeleton when loading

**Header / back:**
- Back link: same styling as Request detail — `Button variant="ghost" size="sm"` with `ArrowLeft`, link to `/environments`
- Title area: environment identifier (project · key / slug) with Badge for status (Deployed, Deploying, Not deployed, Archived)

**Main section:**
- Use `Card` or `section` with `rounded-lg bg-card p-6 shadow-sm` (same as Request detail)
- Metadata: grid layout for Project, Key, Slug, Repo, Archived — match Request's `grid grid-cols-2 gap-x-6 gap-y-3` pattern
- Deploy status banner: keep logic, restyle to match Request's alert/banner patterns (`rounded-lg border bg-muted/30`)

**Sections:**
- Last drift plan: `pt-4 border-t` with consistent typography
- Activity: same `pt-4 border-t`, list styling matching Request detail
- Actions: New Request, Deploy, Drift plan, Destroy — same Button styling and layout as Request detail

**Error / not found:**
- Replace `container max-w-2xl` with `mx-auto max-w-7xl` for consistency; same message + Back link

**Reference:** `app/requests/[requestId]/page.tsx` — RequestDetailSkeleton (lines 83–161), section structure, Card styling, grid layouts.

**Acceptance checks:**
- [ ] Layout matches Request detail: mx-auto max-w-7xl space-y-8
- [ ] Skeleton loading state (EnvironmentDetailSkeleton) instead of Loader2
- [ ] Back link, header, and sections use same visual language
- [ ] Deploy status, metadata, activity, actions styled consistently
- [ ] Existing functionality preserved (deploy, destroy, drift, activity, new request CTA)

**Cursor prompt:**
```
Restyle app/environments/[id]/page.tsx to match app/requests/[requestId]/page.tsx styling. No functional changes; CSS/layout only. Preserve existing data fetch, query params, actions.

- Layout: mx-auto max-w-7xl space-y-8 (not container max-w-2xl)
- Add EnvironmentDetailSkeleton for loading (parallel to RequestDetailSkeleton: header + metadata grid + placeholder buttons)
- Sections: rounded-lg bg-card p-6 shadow-sm
- Back link: Button variant="ghost" size="sm" with ArrowLeft → /environments
- Metadata grid: grid-cols-2 gap-x-6 gap-y-3
- Deploy banner, drift, activity, actions: same spacing (pt-4 border-t) and typography as Request detail
- Preserve all existing functionality
```

---

## Summary

| Step | File | Change |
|------|------|--------|
| 1 | `app/catalogue/page.tsx` | Add Environment Templates section (fetch, search, cards, empty states) |
| 2 | `app/catalogue/environments/[id]/page.tsx` | New env template detail page (modules table, CTA) |
| 3 | `app/environments/new/page.tsx` | New Create Environment wizard (match New Request: steps, Cards, ActionProgressDialog) |
| 4 | `app/environments/page.tsx` | Restyle list: Card, header, "New Environment" button, search + tabs + filters (like Requests), table, SkeletonRow, empty state |
| 5 | `app/environments/[id]/page.tsx` | Restyle detail page to match Request detail (mx-auto max-w-7xl, skeleton, Cards, sections) |

**Best execution order (fastest value):**
1. Step 1 — Catalogue section (quick win, low risk)
2. Step 2 — Env template detail (enables "Use this template")
3. Step 3 — Create Environment wizard (user value)
4. Steps 4 & 5 — Restyles (polish pass; can be done in parallel)

**Dependencies:** Steps 1 and 2 can be done in parallel. Steps 3, 4, 5 can be done in any order; 4 and 5 are independent restyles of existing pages.
