# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

TfPilot is a single Next.js 16 application (not a monorepo) — a Terraform self-service platform with S3-backed persistence, GitHub OAuth, and AI assistant. See `README.md` for full architecture details.

### Running the dev server

```bash
npm run dev
```

The app starts at `http://localhost:3000`. A `.env.local` file is required (copy from `env.example`). The `lib/config/env.ts` module provides build-time placeholders for missing env vars, so the app can compile and start even with dummy values. However, features requiring real AWS/GitHub/OpenAI credentials will fail at runtime without valid secrets.

### Key commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Validate module registry | `npm run validate:registry` |
| Validate server tags | `npm run validate:tags` |

### Gotchas

- **No database**: All data is stored in AWS S3. There is no migration step.
- **Lint errors are pre-existing**: `npm run lint` exits with code 1 due to ~143 `@typescript-eslint/no-explicit-any` errors and ~49 warnings already in the codebase. This is expected.
- **Auth requires real GitHub OAuth**: The login flow redirects to GitHub. With placeholder credentials, the "Continue with GitHub" button will fail at GitHub's OAuth endpoint. To test authenticated flows, real `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` must be provided.
- **Next.js 16 uses Turbopack** by default for `next dev`.
- **Package manager is npm** (lockfile: `package-lock.json`). Do not use pnpm or yarn.
