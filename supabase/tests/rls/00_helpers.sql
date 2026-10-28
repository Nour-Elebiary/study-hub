-- Study Hub — RLS test helpers (run first; created fresh after every db reset).
-- Uses the tiny `tests` schema so it never collides with application tables.

create schema if not exists tests;

create or replace function tests.assert_true(
  condition boolean,
  message text
)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'ASSERT FAILED: %', message;
  end if;
end;
$$;

-- Simulates an authenticated Supabase request context for the given user id.
-- Sets role + request.jwt.claims so auth.uid() resolves to this user.
create or replace function tests.acting_as(uid uuid)
returns void
language sql
as $$
  select set_config (
    'request.jwt.claims',
    json_build_object ('sub', uid, 'role', 'authenticated')::text,
    true -- local to the transaction
  );
$$;

-- The tests call these helpers while role-switched (assert_true evaluates the
-- caller's boolean under that role's own RLS context), so the roles need
-- schema usage. Function execute is public by default; the helpers only raise
-- exceptions and set local GUCs, so this is safe in the local test database.
grant usage on schema tests to anon, authenticated;
