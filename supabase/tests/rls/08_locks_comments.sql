-- Study Hub RLS test 08 — soft locks and comments (spec sections 5 and 6).
-- Lock rules: one person edits at a time, the lock expires after 2 minutes,
-- an owner or admin can break a lock. Comments: every member writes, only
-- the author/owner/admin resolves.

begin;

-- fixtures as the seeded admin (owner of both courses)
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.course_members (course_id, user_id, role, areas)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddd01',
   'editor', array['official_materials'])
on conflict (course_id, user_id) do update set areas = excluded.areas;

-- --- Leader A holds a lock on the sample draft note ---------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

insert into public.locks (node_id, user_id, expires_at)
values (
  'eeeeeeee-0000-eeee-0000-000000000002',
  'dddddddd-dddd-dddd-dddd-dddddddddd01',
  now () + interval '2 minutes'
);

select tests.assert_true (
  (select count (*) from public.locks) = 1,
  'a member can acquire a lock on a note in their course'
);

--- the lock expires: an expired lock is invisible to the editor UI check ------
-- (the row stays but expires_at has passed; the app treats it as free)
update public.locks set expires_at = now () - interval '1 minute'
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

select tests.assert_true (
  (select count (*) from public.locks
    where node_id = 'eeeeeeee-0000-eeee-0000-000000000002'
      and expires_at > now ()) = 0,
  'an expired lock no longer counts as active'
);

--- another member cannot delete Leader A's live lock (restore it first) -------
update public.locks set expires_at = now () + interval '2 minutes'
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

insert into public.course_members (course_id, user_id, role, areas)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddd02',
   'reviewer', array['official_materials'])
on conflict (course_id, user_id) do update set areas = excluded.areas;

set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

delete from public.locks
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

select tests.assert_true (
  (select count (*) from public.locks) = 1,
  'a reviewer cannot break another leader''s lock'
);

--- an owner CAN break the lock -------------------------------------------------
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

delete from public.locks
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

select tests.assert_true (
  (select count (*) from public.locks) = 0,
  'an owner can break another leader''s lock'
);

-- --- comments -----------------------------------------------------------------
--- reviewer comments on the draft note (reviewers read and comment) -----------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

insert into public.comments (node_id, author_id, body)
values (
  'eeeeeeee-0000-eeee-0000-000000000002',
  'dddddddd-dddd-dddd-dddd-dddddddddd02',
  'Please add the second example before publishing.'
);

select tests.assert_true (
  (select count (*) from public.comments) = 1,
  'a reviewer can leave a review comment'
);

--- the author cannot resolve someone else's comment ---------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

update public.comments set resolved = true
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

select tests.assert_true (
  (select resolved from public.comments limit 1) = false,
  'a leader cannot resolve another leader''s comment'
);

--- the owner can resolve it ----------------------------------------------------
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

update public.comments set resolved = true
where node_id = 'eeeeeeee-0000-eeee-0000-000000000002';

select tests.assert_true (
  (select resolved from public.comments limit 1) = true,
  'an owner can resolve a review comment'
);

-- --- peer profiles -------------------------------------------------------------
-- Leader A shares COURSE-A with its owner (the seeded admin) and with Leader B
-- (B is its reviewer since test 07), so A may read their display names — but
-- nobody else's (the second admin owns no course).
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.profiles) = 3,
  'a leader reads only their own and co-member profiles'
);

select tests.assert_true (
  (select display_name from public.profiles
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddd02') = 'Leader B',
  'a leader can read a co-member''s display name'
);

commit;
