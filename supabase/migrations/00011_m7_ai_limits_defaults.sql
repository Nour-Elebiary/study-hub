-- Study Hub — M7 AI assistant: default ai_limits rows (spec section 8).
-- The router compares its own usage counters against these numbers; the
-- admin edits them when Google changes the free tier (spec rule 8: limits
-- live in data, not code). The figures below are conservative placeholders
-- recorded in docs/FREE_TIER.md — the admin must verify them against
-- Google's current published limits before real use.

insert into public.ai_limits (provider, model, rpm, tpm, rpd, soft_pct)
values
  ('gemini', 'gemini-2.5-flash-lite', 10, 200000, 200, 80),
  ('gemini', 'gemini-2.5-flash', 10, 200000, 200, 80)
on conflict (provider, model) do nothing;
