-- Study Hub — node_versions is immutable history (spec section 5): rows are
-- only ever inserted, never updated or deleted by clients. Supabase's
-- default privileges grant ALL on new tables to anon and authenticated, so
-- immutability needs an explicit revoke — the same pattern as nodes and
-- assets in 00005/00006. Without it an UPDATE passes the privilege check
-- and force-RLS (there is no UPDATE policy) silently changes nothing,
-- which is exactly what RLS test 09 guards against.
revoke update, delete on public.node_versions from anon, authenticated;
