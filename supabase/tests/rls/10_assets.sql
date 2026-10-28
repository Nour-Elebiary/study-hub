-- Study Hub RLS test 10 — assets isolation and upload rights
-- (spec sections 4 and 6: every member reads a course's files, editors and
-- contributors upload, reviewers never upload, creators rename their own,
-- and ai_allowed is never writable by clients).
--
-- Fixtures from earlier tests: Leader A = editor in COURSE-A,
-- Leader B = contributor in COURSE-B and reviewer in COURSE-A,
-- Leader C = no memberships (created in test 09).
-- Seed adds one Drive-linked asset on the COURSE-A quiz note.

begin;

-- --- the seeded admin uploads fixtures into both courses ---------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.assets (id, course_id, node_id, kind, storage, path_or_url, title, mime, size_bytes)
values
  ('a1a1a1a1-1000-4a1a-8a1a-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'eeeeeeee-0000-eeee-0000-000000000002', 'pdf', 'supabase',
   'cccccccc-0000-cccc-0000-000000000001/kXq9tRwLm2pQvN4s.pdf',
   'Lecture 1 handout', 'application/pdf', 204800),
  ('a1a1a1a1-1000-4a1a-8a1a-000000000002', 'cccccccc-0000-cccc-0000-000000000001',
   null, 'image', 'link', 'https://example.com/diagram.png',
   'Course diagram', 'image/png', 51200),
  ('a1a1a1a1-1000-4a1a-8a1a-000000000003', 'cccccccc-0000-cccc-0000-000000000002',
   null, 'document', 'drive',
   'https://drive.google.com/file/d/1EXAMPLE-course-b-sheet/view',
   'B answer sheet', 'application/pdf', 15728640);

-- --- Leader A (editor, COURSE-A) ----------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.assets) = 4,
  'editor reads their course''s assets: seed Drive link + two uploads'
);

select tests.assert_true (
  (select count (*) from public.assets
    where course_id = 'cccccccc-0000-cccc-0000-000000000002') = 0,
  'editor cannot read another course''s assets even by direct API call'
);

--- an editor may upload into their course --------------------------------------
insert into public.assets (id, course_id, node_id, kind, storage, path_or_url, title, mime, size_bytes)
values (
  'a1a1a1a1-1000-4a1a-8a1a-000000000004', 'cccccccc-0000-cccc-0000-000000000001',
  'eeeeeeee-0000-eeee-0000-000000000002', 'pdf', 'supabase',
  'cccccccc-0000-cccc-0000-000000000001/Zp8wNcTf3hJr6vBq.pdf',
  'My scanned page', 'application/pdf', 81920
);

select tests.assert_true (
  (select created_by from public.assets
    where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004')
    = 'dddddddd-dddd-dddd-dddd-dddddddddd01'::uuid,
  'created_by defaults to the uploading leader'
);

--- an editor may NOT upload into another course --------------------------------
do $$
begin
  insert into public.assets (course_id, kind, storage, path_or_url, title)
  values (
    'cccccccc-0000-cccc-0000-000000000002', 'pdf', 'supabase',
    'cccccccc-0000-cccc-0000-000000000002/hack.pdf', 'hack'
  );
  raise exception 'ASSERT FAILED: editor uploaded into another course';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- the creator renames their own upload ----------------------------------------
update public.assets set title = 'My scanned page (renamed)'
where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004';

select tests.assert_true (
  (select title from public.assets
    where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004') = 'My scanned page (renamed)',
  'the creator renames their own asset'
);

--- a non-creator cannot rename someone else's asset (silently filtered) --------
update public.assets set title = 'hacked'
where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000001';

select tests.assert_true (
  (select title from public.assets
    where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000001') = 'Lecture 1 handout',
  'a non-creator cannot rename another leader''s asset'
);

--- ai_allowed has no client grant (spec: the AI router must trust it) ----------
do $$
begin
  update public.assets set ai_allowed = true
  where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004';
  raise exception 'ASSERT FAILED: client flipped ai_allowed';
exception
  when insufficient_privilege then
    null; -- expected: ai_allowed is not in the UPDATE column grant
end $$;

do $$
begin
  insert into public.assets (
    course_id, kind, storage, path_or_url, title, ai_allowed
  ) values (
    'cccccccc-0000-cccc-0000-000000000001', 'pdf', 'supabase',
    'cccccccc-0000-cccc-0000-000000000001/hack2.pdf', 'hack', true
  );
  raise exception 'ASSERT FAILED: client set ai_allowed on insert';
exception
  when insufficient_privilege then
    null; -- expected: ai_allowed is not in the INSERT column grant
end $$;

--- student flags ARE client-writable (they gate the student site) --------------
update public.assets set student_visible = false
where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004';

select tests.assert_true (
  (select student_visible from public.assets
    where id = 'a1a1a1a1-1000-4a1a-8a1a-000000000004') = false,
  'the creator can hide their asset from students'
);

-- --- Leader B (contributor COURSE-B, reviewer COURSE-A) ------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.assets
    where course_id = 'cccccccc-0000-cccc-0000-000000000001') = 5,
  'reviewer membership grants read access to the reviewed course''s assets'
);

--- a reviewer may NOT upload (reviewers read, they do not write) ---------------
do $$
begin
  insert into public.assets (course_id, kind, storage, path_or_url, title)
  values (
    'cccccccc-0000-cccc-0000-000000000001', 'pdf', 'supabase',
    'cccccccc-0000-cccc-0000-000000000001/reviewer-hack.pdf', 'hack'
  );
  raise exception 'ASSERT FAILED: reviewer uploaded into the reviewed course';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- a contributor uploads into their own course ----------------------------------
insert into public.assets (id, course_id, kind, storage, path_or_url, title, mime, size_bytes)
values (
  'a1a1a1a1-1000-4a1a-8a1a-000000000005', 'cccccccc-0000-cccc-0000-000000000002',
  'image', 'supabase',
  'cccccccc-0000-cccc-0000-000000000002/Mn4kLp9sDw2yXc7t.jpg',
  'Whiteboard photo', 'image/jpeg', 65536
);

select tests.assert_true (
  (select count (*) from public.assets
    where course_id = 'cccccccc-0000-cccc-0000-000000000002') = 2,
  'contributor reads and adds assets in their own course'
);

-- --- Leader C (no memberships) ---------------------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd03","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.assets) = 0,
  'a leader with no memberships sees no assets at all'
);

-- --- storage paths ---------------------------------------------------------------
-- Back to Leader A: the path helper ties storage objects to course membership.
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

select tests.assert_true (
  public.can_access_storage_path (
    'cccccccc-0000-cccc-0000-000000000001/kXq9tRwLm2pQvN4s.pdf'
  ),
  'the storage path helper allows a member''s own course path'
);

select tests.assert_true (
  not public.can_access_storage_path (
    'cccccccc-0000-cccc-0000-000000000002/Mn4kLp9sDw2yXc7t.jpg'
  ),
  'the storage path helper rejects another course''s path'
);

select tests.assert_true (
  not public.can_access_storage_path ('not-a-course-path/file.pdf'),
  'the storage path helper rejects paths without a course id'
);

--- a member uploads a storage object under their course's path ------------------
insert into storage.objects (bucket_id, name)
values (
  'assets', 'cccccccc-0000-cccc-0000-000000000001/kXq9tRwLm2pQvN4s.pdf'
);

--- and cannot under another course's path ----------------------------------------
do $$
begin
  insert into storage.objects (bucket_id, name)
  values (
    'assets', 'cccccccc-0000-cccc-0000-000000000002/Mn4kLp9sDw2yXc7t.jpg'
  );
  raise exception 'ASSERT FAILED: storage upload into another course''s path';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

commit;
