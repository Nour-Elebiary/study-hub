-- Study Hub M8: one read-only size probe for the Content health screen
-- (spec section 9: "database and storage use against the free limits with a
-- warning at 70%"). PostgREST only exposes the public schema and has no way
-- to ask for the database size, so this SECURITY DEFINER function runs the
-- size query inside the database. Storage use is measured differently: the
-- health screen lists the assets bucket through the Storage API, because
-- storage.objects has its own RLS that the postgres role does not bypass.

create function public.db_size_bytes() returns bigint
language sql stable security definer
set search_path = pg_catalog
as $$
  select pg_database_size(current_database());
$$;

-- Functions are executable by PUBLIC by default; only the server's service
-- role may call this one.
revoke execute on function public.db_size_bytes()
  from public, anon, authenticated;
grant execute on function public.db_size_bytes() to service_role;
