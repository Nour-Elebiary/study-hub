-- Study Hub RLS test 06 — a leader cannot perform admin actions by calling
-- the database API directly (spec section 4 rule 4 and M1 acceptance tests).
-- Uses Leader A, created by test 03.

begin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

--- a leader cannot create a course -------------------------------------------
do $$
begin
  insert into public.courses (code, title) values ('HACK-1', 'Should not exist');
  raise exception 'ASSERT FAILED: leader created a course';
exception
  when insufficient_privilege then
    null; -- expected: RLS insert policy rejects non-admins
end $$;

--- a leader cannot add themselves (or anyone) to a course ---------------------
do $$
begin
  insert into public.course_members (course_id, user_id, role)
  values (
    'cccccccc-0000-cccc-0000-000000000001',
    'dddddddd-dddd-dddd-dddd-dddddddddd01',
    'owner'
  );
  raise exception 'ASSERT FAILED: leader granted themselves a membership';
exception
  when insufficient_privilege then
    null; -- expected: write policy allows only owners/admins
end $$;

--- a disabled leader cannot re-enable themselves (column not granted) --------
do $$
begin
  update public.profiles set is_active = false
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  raise exception 'ASSERT FAILED: leader toggled is_active';
exception
  when insufficient_privilege then
    null; -- expected: is_active has no UPDATE grant for authenticated
end $$;

--- a leader cannot write to the audit log ------------------------------------
do $$
begin
  insert into public.audit_log (action, entity) values ('hack', 'audit_log');
  raise exception 'ASSERT FAILED: leader wrote an audit row';
exception
  when insufficient_privilege then
    null; -- expected: no INSERT policy for authenticated
end $$;

--- a leader cannot rename a course (RLS silently filters the update) ---------
update public.courses set title = 'hacked'
where code = 'COURSE-A';

select tests.assert_true (
  (select title from public.courses where code = 'COURSE-A')
    = 'Course A (sample)',
  'leader cannot rename a course'
);

commit;
