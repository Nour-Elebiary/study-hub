<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Study Hub agent constitution (spec section 12)

1. Read the whole specification first. Build one milestone at a time. Do not start the next milestone until the acceptance tests of the current one pass.
2. Do not invent requirements. If something is unclear, choose the simplest safe option and write the question in `docs/QUESTIONS.md`.
3. TypeScript strict, no `any`. Validate every input at the boundary with zod. Server-only code lives in modules marked `server-only`.
4. Never put secrets in code, tests, logs or commits. Use `.env.example`.
5. Every new table needs a migration, RLS policies and an RLS test. Never disable RLS or a test to make something work.
6. Mobile first at 360 px width. Plain labels for non-technical users. Accessible by default. Test with a Playwright mobile viewport.
7. Before adding a dependency or service, confirm it is free for this use and record the date and the source in `docs/FREE_TIER.md`.
8. Keep limits (file sizes, AI limits, retention) in `settings` or `ai_limits`, not in code.
9. AI code must follow section 8 of the spec: no code that hides which project a request comes from, rotates accounts, or evades quota controls. Every AI key is created in its owner's own Google account/project and is used only by that owner.
10. Run `npm run lint && npm run typecheck && npm test` before every commit. Use small commits with clear messages.
11. Write every guide in `docs/` in plain language for non-technical leaders.
