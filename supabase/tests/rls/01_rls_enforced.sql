-- Study Hub RLS test 01 — every table in the public schema MUST have RLS.
-- Spec section 11.3: the build fails if any table lacks row-level security.

begin;

do $$
declare
  r record;
  unprotected_rows text := '';
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public' and tablename not like 'pg_%'
  loop
    if not coalesce (
      (select rowsecurity from pg_tables
       where schemaname = 'public' and tablename = r.tablename),
      false
    ) then
      raise exception 'RLS MISSING: table public.% is not row-level secure', r.tablename;
    end if;
  end loop;

  select count (*) into unprotected_rows
  from pg_tables
  where schemaname = 'public'
    and rowsecurity = false;
end $$;

select tests.assert_true (
  true,
  'all public tables are row-level secure'
);

commit;
