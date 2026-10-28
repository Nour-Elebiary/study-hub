-- Study Hub RLS test 12 — jobs queue isolation (spec sections 5 and 7).
-- Admins and the course's leaders read a course's jobs; only admins,
-- owners, editors and contributors start them; only the creator (or an
-- admin) updates a job — the browser runner writes its own progress.
-- Cancelling is an update to failed; there is no delete policy.
--
-- Fixtures from earlier tests: Leader A = editor in COURSE-A,
-- Leader B = contributor in COURSE-B and reviewer in COURSE-A,
-- Leader C = no memberships (created in test 09).

begin;

-- --- the seeded admin uploads fixtures into both courses ---------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.assets (id, course_id, kind, storage, path_or_url, title, mime)
values
  ('a1a1a1a1-2000-4a1a-8a1a-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'image', 'supabase', 'cccccccc-0000-cccc-0000-000000000001/Qw3nP7xRmZk9sVt2.jpg',
   'Board photo', 'image/jpeg'),
  ('a1a1a1a1-2000-4a1a-8a1a-000000000002', 'cccccccc-0000-cccc-0000-000000000002',
   'image', 'supabase', 'cccccccc-0000-cccc-0000-000000000002/Jm8vTq2LxwR5nBc5.jpg',
   'B board photo', 'image/jpeg');

-- --- Leader A (editor, COURSE-A) starts an OCR job ----------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

insert into public.jobs (id, course_id, type, runner, input_asset_id, params)
values (
  'f5f5f5f5-0000-4f5f-8f5f-000000000001',
  'cccccccc-0000-cccc-0000-000000000001',
  'ocr', 'browser', 'a1a1a1a1-2000-4a1a-8a1a-000000000001',
  '{"languages":["eng","ara"]}'::jsonb
);

select tests.assert_true (
  (select status from public.jobs where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001')
    = 'queued',
  'a new job starts queued with created_by set to the leader'
);

select tests.assert_true (
  (select created_by from public.jobs where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001')
    = 'dddddddd-dddd-dddd-dddd-dddddddddd01'::uuid,
  'created_by is the leader who started the job'
);

--- an editor may NOT start a job in another course -----------------------------
do $$

begin
  insert into public.jobs (course_id, type, runner, input_asset_id)
  values (
    'cccccccc-0000-cccc-0000-000000000002', 'ocr', 'browser',
    'a1a1a1a1-2000-4a1a-8a1a-000000000002'
  );
  raise exception 'ASSERT FAILED: editor started a job in another course';
exception
  when insufficient_privilege then
    null; -- expected
end $$;

--- the creator runs their job and writes progress back -------------------------
update public.jobs
set status = 'running', attempts = 1
where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001';

select tests.assert_true (
  (select status from public.jobs where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001')
    = 'running',
  'the creator (the browser runner) updates their own job'
);

--- another course's leader cannot update someone else's job --------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

with u as (
  update public.jobs set status = 'failed'
  where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001'
    and course_id = 'cccccccc-0000-cccc-0000-000000000001'
  returning id
)
select tests.assert_true (
  (select count (*) from u) = 0,
  'a non-creator leader cannot update another leader''s job (0 rows match)'
);

--- a reviewer reads the course's jobs but never starts one ---------------------
select tests.assert_true (
  (select count (*) from public.jobs
    where course_id = 'cccccccc-0000-cccc-0000-000000000001') = 1,
  'a reviewer (course member) reads the course''s jobs'
);

do $$

begin
  insert into public.jobs (course_id, type, runner, input_asset_id)
  values (
    'cccccccc-0000-cccc-0000-000000000001', 'convert', 'browser',
    'a1a1a1a1-2000-4a1a-8a1a-000000000001'
  );
  raise exception 'ASSERT FAILED: reviewer started a job';
exception
  when insufficient_privilege then
    null; -- expected: reviewers never upload or start jobs
end $$;

--- cancelling is an update to failed by the creator ----------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

update public.jobs
set status = 'failed', error = 'Cancelled', finished_at = now ()
where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001';

select tests.assert_true (
  (select status from public.jobs where id = 'f5f5f5f5-0000-4f5f-8f5f-000000000001')
    = 'failed',
  'the creator cancels their own job'
);

--- a leader with no memberships sees no jobs ------------------------------------
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd03","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.jobs) = 0,
  'a leader outside every course reads no jobs'
);

--- anon reads nothing (RLS is on; anon has no policy) ---------------------------
set local role anon;

select tests.assert_true (
  (select count (*) from public.jobs) = 0,
  'anon reads no jobs'
);

--- the admin reads every course's jobs -------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.jobs) = 1,
  'the admin reads all jobs'
);

--- the jobs table ships on the Realtime publication (live status) ----------------
select tests.assert_true (
  (select count (*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'jobs') = 1,
  'jobs is on the supabase_realtime publication for live status updates'
);

commit;
