-- Study Hub RLS test 03 — a leader reads only their own profile and can
-- never escalate their own role or touch the audit log (spec M0 step 5,
-- M1 acceptance: "A leader outside a course cannot read its drafts, even by
-- calling the database API directly").

begin;

-- fixture: two leaders (the seed admin aaaaaaaa… is created by seed.sql)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'authenticated', 'authenticated',
   'leaderA@studyhub.local', crypt ('LeaderA-Temp-01', gen_salt ('bf')), now (),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Leader A"}', now (), now ()),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-dddd-dddd-dddddddddd02', 'authenticated', 'authenticated',
   'leaderB@studyhub.local', crypt ('LeaderB-Temp-01', gen_salt ('bf')), now (),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Leader B"}', now (), now ());

-- --- Leader A sees exactly their own profile row -----------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.profiles) = 1
    and (select id from public.profiles limit 1)
      = 'dddddddd-dddd-dddd-dddd-dddddddddd01'::uuid,
  'leader sees exactly one profile (own) row'
);

--- a leader cannot read other courses ----------------------------------------
select tests.assert_true (
  (select count (*) from public.courses) = 0,
  'non-member leader reads zero course rows even via direct database call'
);

select tests.assert_true (
  (select count (*) from public.course_members) = 0,
  'non-member leader reads zero membership rows even via direct database call'
);

--- a leader cannot read the audit log ----------------------------------------
select tests.assert_true (
  (select count (*) from public.audit_log) = 0,
  'leader reads zero audit rows'
);

--- a leader cannot escalate their role (column-level grant) -------------------
do $$
begin
  update public.profiles set global_role = 'admin'
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  raise exception 'ASSERT FAILED: leader changed global_role';
exception
  when insufficient_privilege then
    null; -- expected: UPDATE on global_role is denied for authenticated
end $$;

--- a leader cannot delete their own profile (no DELETE policy → silently
-- filtered, so the row must still exist afterwards) ---------------------------
delete from public.profiles
where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';

select tests.assert_true (
  (select count (*) from public.profiles) = 1,
  'leader cannot delete their own profile row'
);

-- --- Leader B sees their own row only, not Leader A's -------------------------
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.profiles) = 1
    and (select id from public.profiles limit 1)
      = 'dddddddd-dddd-dddd-dddd-dddddddddd02'::uuid,
  'leader B sees exactly one profile (own) row'
);

commit;
