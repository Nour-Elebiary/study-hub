-- Study Hub RLS test 15 — the health size probe (spec section 9, security
-- rule 2: no route touches data without the right role). The database-size
-- function must be executable by the service role only; every client role
-- gets a permission error, so the number can never be read through the API.

begin;

do $$
begin
  -- anon must not be able to call it
  begin
    set local role anon;
    perform public.db_size_bytes();
    raise exception 'anon could execute db_size_bytes';
  exception when insufficient_privilege then
    null; -- expected
  end;
end $$;

do $$
begin
  -- authenticated leaders must not be able to call it either
  begin
    set local role authenticated;
    perform public.db_size_bytes();
    raise exception 'authenticated could execute db_size_bytes';
  exception when insufficient_privilege then
    null; -- expected
  end;
end $$;

reset role;

select tests.assert_true (
  public.db_size_bytes() > 0,
  'the database size probe returns a positive number for the service role'
);

commit;
