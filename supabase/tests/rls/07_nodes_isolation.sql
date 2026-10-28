-- Study Hub RLS test 07 — content-tree isolation and write rights
-- (spec section 4 rule 4, M2 acceptance: the draft → review → publish flow
-- respects roles, even when a leader calls the database API directly).
--
-- Fixtures: Leader A = editor in COURSE-A (official_materials only),
-- Leader B = contributor in COURSE-B (student_notes only) and reviewer in
-- COURSE-A. Sample notes come from seed.sql.

begin;

-- memberships (written as the seeded admin, who owns both courses)
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.course_members (course_id, user_id, role, areas)
values
  ('cccccccc-0000-cccc-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddd01',
   'editor', array['official_materials']),
  ('cccccccc-0000-cccc-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddd02',
   'contributor', array['student_notes']),
  ('cccccccc-0000-cccc-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddd02',
   'reviewer', array['official_materials']);

-- a draft note in an area Leader A may write, created by the admin
-- (created_by is not grantable to clients — it defaults to auth.uid())
insert into public.nodes (id, course_id, area, kind, title, slug)
values
  ('eeeeeeee-1000-eeee-0000-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'official_materials', 'note', 'Area note', 'area-note'),
  ('eeeeeeee-1000-eeee-0000-000000000003', 'cccccccc-0000-cccc-0000-000000000002',
   'official_materials', 'note', 'B other area', 'b-other-area');

-- --- Leader A (editor, official_materials in COURSE-A) -----------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.nodes) = 4, -- three seed nodes + the area note
  'leader A reads only COURSE-A nodes, never COURSE-B drafts'
);

select tests.assert_true (
  (select count (*) from public.nodes
    where course_id = 'cccccccc-0000-cccc-0000-000000000002') = 0,
  'leader A cannot read COURSE-B nodes even by direct API call'
);

--- editor may write a version on a note in their area -------------------------
insert into public.node_versions (node_id, body_md, author_id, change_note)
values (
  'eeeeeeee-1000-eeee-0000-000000000001',
  'Edited by leader A', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'edit'
);

--- editor may NOT write outside their assigned area ---------------------------
do $$
begin
  insert into public.node_versions (node_id, body_md, author_id, change_note)
  values (
    'eeeeeeee-0000-eeee-0000-000000000003', -- quiz_exam_prep, not assigned
    'should fail', 'dddddddd-dddd-dddd-dddd-dddddddddd01', 'hack'
  );
  raise exception 'ASSERT FAILED: editor wrote outside assigned area';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- editor cannot change status directly (no column grant) ---------------------
do $$
begin
  update public.nodes set status = 'published'
  where id = 'eeeeeeee-1000-eeee-0000-000000000001';
  raise exception 'ASSERT FAILED: editor published a note directly';
exception
  when insufficient_privilege then
    null; -- expected: status has no UPDATE grant for authenticated
end $$;

-- --- Leader B (contributor, student_notes in COURSE-B; reviewer in A) --------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

--- contributor reads COURSE-B nodes and COURSE-A nodes (as its reviewer) ------
select tests.assert_true (
  (select count (*) from public.nodes
    where course_id = 'cccccccc-0000-cccc-0000-000000000002') = 1,
  'contributor reads their own course nodes'
);

select tests.assert_true (
  (select count (*) from public.nodes
    where course_id = 'cccccccc-0000-cccc-0000-000000000001') = 4,
  'reviewer membership grants read access to the reviewed course'
);

--- contributor creates their own draft in an assigned area --------------------
insert into public.nodes (id, course_id, area, kind, title, slug)
values (
  'eeeeeeee-1000-eeee-0000-000000000002', 'cccccccc-0000-cccc-0000-000000000002',
  'student_notes', 'note', 'B own draft', 'b-own-draft'
);

select tests.assert_true (
  (select created_by from public.nodes
    where id = 'eeeeeeee-1000-eeee-0000-000000000002')
    = 'dddddddd-dddd-dddd-dddd-dddddddddd02'::uuid,
  'created_by defaults to the creating leader'
);

--- contributor may edit their OWN draft ---------------------------------------
update public.nodes set title = 'B own draft (edited)'
where id = 'eeeeeeee-1000-eeee-0000-000000000002';

select tests.assert_true (
  (select title from public.nodes
    where id = 'eeeeeeee-1000-eeee-0000-000000000002') = 'B own draft (edited)',
  'contributor edits their own draft'
);

--- contributor may NOT edit someone else's note (silently filtered) ----------
update public.nodes set title = 'hacked'
where id = 'eeeeeeee-1000-eeee-0000-000000000003';

select tests.assert_true (
  (select title from public.nodes
    where id = 'eeeeeeee-1000-eeee-0000-000000000003') = 'B other area',
  'contributor cannot edit a note they did not create'
);

--- contributor cannot create a note outside their areas ----------------------
do $$
begin
  insert into public.nodes (course_id, area, kind, title, slug)
  values (
    'cccccccc-0000-cccc-0000-000000000002',
    'official_materials', 'note', 'outside area', 'outside-area'
  );
  raise exception 'ASSERT FAILED: contributor wrote outside assigned areas';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- reviewer cannot write versions on the course they only review -------------
do $$
begin
  insert into public.node_versions (node_id, body_md, author_id, change_note)
  values (
    'eeeeeeee-0000-eeee-0000-000000000002', -- COURSE-A note
    'reviewer hack', 'dddddddd-dddd-dddd-dddd-dddddddddd02', 'hack'
  );
  raise exception 'ASSERT FAILED: reviewer wrote a version';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

commit;
