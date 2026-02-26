Overview

**TfPilot** is an internal platform for managing infrastructure requests (project + environment + module + config). The design adopts a minimal, Vercel-like aesthetic with neutral tones and clear spacing. All pages use a centered container (max-w-4xl or max-w-7xl) for content. **Use background colors to separate sections, inputs, table rows/columns, and cards—not border colors.** This applies in both light and dark modes: rely on `bg-muted`, `bg-card`, `bg-muted/50`, etc. Use shadcn/ui components (Cards, Forms, Tables, etc.). **Status is derived only** (deriveLifecycleStatus); use lib/status/status-config for labels and colors. See docs/REQUEST_LIFECYCLE.md, docs/GLOSSARY.md.

Navigation & Layout

Main Nav: A simple top navigation bar with the TfPilot logo on the left and key links (e.g. Requests, New Request, AWS Connect) on the right. Use a <nav> with horizontal <Button> or <Link> items. Use the same background as cards: `bg-card` with optional `backdrop-blur`—no border or box shadow.

Global Container: All pages use <main class="min-h-screen p-8"> and a centered inner <div class="max-w-4xl mx-auto"> (or max-w-7xl for wider views) for content.

Sections: Pages are divided into vertical sections (header/title, content body). Separate section headers from content using background contrast (e.g. header `bg-muted/40`, content on `bg-card` or default). Use space-y-6 or similar Tailwind spacing between sections. Headings use text-2xl font-bold (as in the Vercel example) and subheaders text-lg font-semibold. Secondary text (e.g. descriptions) uses a muted color (text-gray-600 or text-muted-foreground).

New Infra Request (/requests/new)

Page Title: “New Infrastructure Request” (use <h1>). Optionally show a breadcrumb or step indicator at top.

Form Layout: A form wrapped in a <Card> with padding. The form has sections: (1) Select Project/Env/Module, (2) Configure Module. Use Tailwind grid or flex to align fields: e.g. two-column on desktop (grid grid-cols-2 gap-4), one-column on mobile.

Fields: Use shadcn Select components for dropdowns (Project, Environment, Module). After a module is selected, dynamically render the module’s config fields (e.g. text inputs, toggles). Label each field clearly with <Label> and <Input>.

Submit: A primary <Button> (“Plan & Submit”) at the bottom. Use a right-aligned button group: “Cancel” (outline style) and “Plan & Submit” (solid primary).

Empty/Helper States: If no projects exist yet, show an empty state card (“No projects found. Create a project first.” with a link). For missing module config, show a placeholder message within the card.

Plan Diff Viewer (Part of /requests/[id])

Context: After submitting a request, the UI should show the Terraform plan output with changes. The design uses a side-by-side comparison of “Before” vs “After” plan states.

Layout: Two text areas or panels labeled “Current State” and “Proposed Changes”. These can be inside a <Card> or <Tabs> if toggling. Highlight additions in green (bg-green-50/text-green-700) and deletions in red (bg-red-50/text-red-700). Use a monospaced font for clarity.

Features: Provide a toggle or filters to show only certain change types (similar to tfdiff’s interactive UI). For example, buttons or checkboxes to “Show Only Creates”, “Only Destroys”, or a search box. This lets users focus on specific changes.

Controls: Include a “Run Plan Again” or “Approve & Apply” button. If errors occur, display an error banner at top of the panel (red background with the error message).

Infra Request Detail & Timeline (/requests/[requestId])

Header: Display key request details in a <CardHeader>: e.g. Request ID, status badge (Approved/Pending), submitted date, user.

Configuration Summary: Show the chosen project, environment, and module with config values in a read-only form or table. Use a <Card> with <CardContent> listing these details in text or a key-value table.

Status Timeline: A vertical timeline showing **canonical lifecycle steps** (from deriveLifecycleStatus): request_created → planning → plan_ready → approved → merged → applying → applied (or failed); destroy: destroying → destroyed. Use lib/status/status-config for labels. Each step: icon and description; timestamps from lifecycle logs.

Use background or spacing to separate steps (e.g. each step in a subtle bg-muted/30 block), not borders.

Completed steps show a green check icon; pending steps show a spinner or gray circle.

Include timestamp and brief notes (e.g. “Plan succeeded”).

Example (ASCII wireframe):

● Request created → ✔ Plan ready → ◌ Approved → ◌ Merged → ✔ Applied (or Failed / Destroying / Destroyed). Use status-config for labels.


Callouts: For steps like “Awaiting Approval”, show a highlight (yellow background) to draw attention.

List Views

Requests List (/requests): A table or list of all infra requests. Use a shadcn <Table> or a series of <Card> rows. Columns/fields: Request ID, Project, Environment, Status, Last Updated, Actions. Include a search bar and filter dropdown (e.g. filter by status). A “New Request” button should be prominently placed above the table.

Environments List (/environments): Show all configured environments. Could be cards or table with Environment Name, AWS Account, Region, and Actions (edit/delete). If empty, display an empty state card: “No environments yet. Connect AWS to create one.” with a button to connect.

Modules List (/modules): Display available infrastructure modules/templates. Each item can be a <Card> with module name, description, and a “View” or “Edit” button. In table mode, columns: Module Name, Description, Version.

AWS Connection Flow (/aws/connect)

Overview Text: A short explanation card: “To connect your AWS account, run the provided CloudFormation stack which will create a role for tfplan.”

External ID: Prominently display the External ID inside a read-only <Input> or <Code> box with a copy button. This should stand out (e.g. with a shaded background). Label it “External ID for AWS Console”.

CloudFormation Link: Provide a <Button> linking to AWS CloudFormation with the template URL (labeled “Deploy to AWS CloudFormation”). Use the official AWS “Launch Stack” style link.

Steps: List out steps in a small numbered list or checklist:

Copy the External ID above.

Click the button to open AWS CloudFormation.

In AWS console, paste the External ID when prompted.

Empty States: If the external ID or stack URL is not generated yet, show a disabled state and instruct to refresh.

Component Usage

Shadcn Components: Use shadcn/ui’s prebuilt components for all UI elements. For example:

Form Controls: <Input>, <Select>, <Label>, <Switch> for settings.

Layout: <Card> for grouping, <Tabs> for switching views, <Table> for tabular data.

Feedback: <Button> for actions, <Spinner> or animated <div> for loading states.

Icons: Utilize Lucide or Radix icons (e.g. <Icons.Wrench> for modules, <Icons.Cloud> for AWS). Ensure icon sizes are uniform (e.g. w-5 h-5).

Colors: Stick to a neutral palette. Use background colors (e.g. muted, card, muted/50) to separate sections, inputs, and table rows—avoid border colors for separation in both light and dark modes. Highlight important statuses in color (green for success, red for errors). Ensure text meets contrast guidelines.

Design Guidelines

Spacing: Use consistent padding and margins. e.g. page p-8, cards p-6. Between list items or form fields use mb-4 or space-y-4.

Typography: Follow a clear hierarchy. Headings: text-2xl or text-xl (bold). Body text: text-base or text-sm. Muted text: text-gray-600. Align text left.

Colors & Theme: Support both light and dark modes. Use background colors to create separation: light theme with white or very light gray (e.g. bg-background, bg-muted/50 for inputs and headers); dark theme with dark surfaces (e.g. bg-muted/40 for inputs). No border-based separation—use bg only. Use one accent color for primary buttons (e.g. blue).

Responsive Behavior: On small screens, collapse multi-column layouts into single column. Navigation may become a hamburger menu or vertical list. Ensure touch targets (buttons, links) are at least 44px high.

Empty & Error States: Provide illustrative icons or subtle illustrations for empty states. Error messages should use a red alert banner (e.g. bg-red-50 dark:bg-red-950/40, no borders).

Example Project Structure (for reference). TfPilot uses Next.js App Router; adjust paths to app/, components/, lib/ as in repo.
tfpilot-ui/
├── app/
│   ├── layout.tsx             # Root layout (nav, footer)
│   ├── page.tsx               # Dashboard or redirect
│   ├── environments/
│   │   └── page.tsx           # List of environments
│   ├── modules/
│   │   └── page.tsx           # List of modules
│   ├── aws/
│   │   └── connect/
│   │       └── page.tsx       # AWS connection instructions
│   └── requests/
│       ├── page.tsx           # List of requests
│       ├── new/
│       │   └── page.tsx       # New infra request form
│       └── [requestId]/
│           ├── page.tsx       # Request detail & timeline
│           └── plan/
│               └── page.tsx   # Terraform plan diff viewer (optional)
├── components/
│   └── ui/                    # shadcn/ui components (Card, Input, etc.)
│       ├── Card.tsx
│       ├── Button.tsx
│       ├── Input.tsx
│       └── ... 
└── lib/                       # Utility functions (e.g. formatters, API clients)


This structure matches Next.js best practices.

References

Use examples and best practices from Vercel and shadcn. For instance, Vercel’s template uses a centered max-w-4xl container and clean card layouts, and shadcn/ui provides Radix-based Tailwind components.

Design philosophy is based on modern clean UI trends (simplicity, whitespace).

The Terraform plan diff viewer should allow side-by-side comparison of “before” vs “after” states, with interactive filters as in tools like tfdiff.