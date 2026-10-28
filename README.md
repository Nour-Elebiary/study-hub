# Study Hub

A small, private web platform where **leaders** build study material for
their courses and **students** read it — nothing else. Built with Next.js,
Supabase, and shadcn/ui, designed to run entirely on free tiers.

- Mobile first: designed at 360 px width, then made bigger.
- Every piece of content belongs to a course, and every leader belongs to
  zero or more courses. No course, no access — enforced by the database
  itself (row-level security), not just by the app.
- AI help (optional, per leader): each leader uses **their own** Gemini API
  key from **their own** Google account. Keys are encrypted and never
  shared. See `docs/FREE_TIER.md` for the terms we follow.

## For developers

### Stack

| Layer                   | Choice                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Web app                 | Next.js 16 (App Router, Server Actions, `proxy.ts` for middleware) |
| Database, auth, storage | Supabase (Postgres + row-level security)                           |
| UI components           | shadcn/ui (Radix + Tailwind CSS v4)                                |
| Validation              | zod at every boundary                                              |
| Unit tests              | Vitest + Testing Library                                           |
| E2E tests               | Playwright (mobile 360 px viewport first)                          |
| Database tests          | SQL RLS test files run against local Supabase                      |
| CI                      | GitHub Actions — lint, typecheck, unit, RLS, secret scan, audit    |

### Getting started

Requirements: Node 24+, npm, Docker Desktop (for local Supabase).

```bash
npm install
cp .env.example .env.local   # fill in values from `supabase status`
npx supabase start           # local database + auth
npx supabase db reset        # apply migrations + seed (seed admin: admin@studyhub.local / ChangeMe-Admin-01)
npm run dev
```

The seed admin must change their password at first sign-in — that is the
enforced flow, not a bug.

### Everyday commands

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm test              # Vitest unit tests
npm run test:rls      # SQL RLS tests (needs local Supabase running)
npm run test:e2e      # Playwright (needs app + local Supabase)
npm run build         # production build
```

Run `npm run lint && npm run typecheck && npm test` before every commit.

### Rules for agents (and humans)

Read `AGENTS.md` before writing code. The short version:

1. One milestone at a time; the current milestone's acceptance tests must
   pass before the next one starts.
2. Every new table needs a migration, RLS policies, and an RLS test.
3. No secrets in code, tests, logs, or commits.
4. Mobile first at 360 px. Plain words. Accessible by default.
5. Limits live in the `settings` table, not in code.
6. AI code follows the spec's rules: each leader's own key, used only by
   them; no account rotation, no quota evasion.

### Project layout

```
src/app/            routes (login, reset-password, (leader)/…, api/health)
src/components/ui/  shadcn/ui components
src/lib/            env, schemas (zod), supabase clients, DAL (session gate)
supabase/
  migrations/       numbered SQL migrations
  seed.sql          local/CI seed only — never against production data
  tests/rls/        SQL files; every assert that fails aborts the test
scripts/            test-rls runner
docs/               FREE_TIER.md, QUESTIONS.md, guides for leaders
```

### Docs for non-technical readers

Everything in `docs/` is written in plain language. Start with
`docs/FREE_TIER.md` (what the free services allow) and `docs/QUESTIONS.md`
(open decisions).
