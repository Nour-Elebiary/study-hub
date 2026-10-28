-- Study Hub RLS test 05 — two admins exist (spec section 9, security rule 2:
-- "There are at least two admins, so one lost account never locks everyone
-- out"). The seed creates the primary admin and a backup admin.

begin;

select tests.assert_true (
  (select count (*) from public.profiles where global_role = 'admin') >= 2,
  'at least two admin profiles must exist after seeding'
);

select tests.assert_true (
  (select count (*)
   from public.profiles
   where global_role = 'admin' and is_active and deleted_at is null) >= 2,
  'at least two admins must be active and not soft-deleted'
);

commit;
