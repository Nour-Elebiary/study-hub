-- Study Hub RLS test 13 — Home Worker claim machinery (spec section 7 rule 5).
-- The claim function hands each queued worker job to exactly one worker
-- (FOR UPDATE SKIP LOCKED), skips browser jobs and not-yet-due jobs, records
-- which worker took what, and doubles as the heartbeat. Only the service
-- role may call it; heartbeats are readable by admins only and writable by
-- nobody but the server.
--
-- Fixtures from earlier tests: Leader A = editor in COURSE-A,
-- Leader B = contributor in COURSE-B and reviewer in COURSE-A.

begin;

-- --- the seeded admin inserts fixtures into COURSE-A -------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

insert into public.assets (id, course_id, kind, storage, path_or_url, title, mime)
values
  ('a1a1a1a1-3000-4a1a-8a1a-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'audio', 'supabase', 'cccccccc-0000-cccc-0000-000000000001/Lp4vXw9rQm2nTb8k.mp3',
   'Lecture recording', 'audio/mpeg'),
  ('a1a1a1a1-3000-4a1a-8a1a-000000000002', 'cccccccc-0000-cccc-0000-000000000001',
   'document', 'supabase', 'cccccccc-0000-cccc-0000-000000000001/Zt8kRw3vNq5xPm2j.docx',
   'Chapter summary', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  ('a1a1a1a1-3000-4a1a-8a1a-000000000003', 'cccccccc-0000-cccc-0000-000000000001',
   'video', 'supabase', 'cccccccc-0000-cccc-0000-000000000001/Mm7jQw2xVb9nRt4p.mp4',
   'Lab demo video', 'video/mp4'),
  ('a1a1a1a1-3000-4a1a-8a1a-000000000004', 'cccccccc-0000-cccc-0000-000000000001',
   'image', 'supabase', 'cccccccc-0000-cccc-0000-000000000001/Qr5tXw8kNp2vZm7j.jpg',
   'Board photo', 'image/jpeg');

-- Four jobs: two due worker jobs, one browser job, one not-yet-due worker job.
insert into public.jobs (id, course_id, type, runner, input_asset_id, params, created_by, created_at)
values
  ('f6f6f6f5-1000-4f6f-8f6f-000000000001', 'cccccccc-0000-cccc-0000-000000000001',
   'transcribe', 'worker', 'a1a1a1a1-3000-4a1a-8a1a-000000000001',
   '{"type":"transcribe","languages":["eng","ara"]}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, now () - interval '3 minutes'),
  ('f6f6f6f5-1000-4f6f-8f6f-000000000002', 'cccccccc-0000-cccc-0000-000000000001',
   'convert', 'worker', 'a1a1a1a1-3000-4a1a-8a1a-000000000002',
   '{"type":"convert","tool":"office_to_pdf"}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, now () - interval '2 minutes'),
  ('f6f6f6f5-1000-4f6f-8f6f-000000000003', 'cccccccc-0000-cccc-0000-000000000001',
   'ocr', 'browser', 'a1a1a1a1-3000-4a1a-8a1a-000000000004',
   '{"type":"ocr","languages":["eng"]}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, now () - interval '1 minute'),
  ('f6f6f6f5-1000-4f6f-8f6f-000000000004', 'cccccccc-0000-cccc-0000-000000000001',
   'transcribe', 'worker', 'a1a1a1a1-3000-4a1a-8a1a-000000000001',
   '{"type":"transcribe","languages":["ara"]}'::jsonb,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, now () - interval '4 minutes');
-- run_after is set below by an update: the insert above must match the
-- column list (8 columns), and the not-yet-due state is the update's job.

update public.jobs set run_after = now () + interval '1 hour'
where id = 'f6f6f6f5-1000-4f6f-8f6f-000000000004';

-- --- the worker claims through the service role ------------------------------
set local role service_role;

select tests.assert_true (
  (select job_id from public.claim_worker_job ('w1'))
    = 'f6f6f6f5-1000-4f6f-8f6f-000000000001'::uuid,
  'the first claim takes the oldest DUE worker job (the not-yet-due one waits)'
);

select tests.assert_true (
  (select job_id from public.claim_worker_job ('w1'))
    = 'f6f6f6f5-1000-4f6f-8f6f-000000000002'::uuid,
  'the second claim takes the next due worker job'
);

select tests.assert_true (
  (select count (*) from public.claim_worker_job ('w1')) = 0,
  'nothing is left to claim: the browser job and the not-yet-due job stay put'
);

select tests.assert_true (
  (select count (*) from public.claim_worker_job ('w2')) = 0,
  'a second worker finds an empty queue — no job is ever handed out twice'
);

--- the claimed jobs are marked running with the worker's name ------------------
select tests.assert_true (
  (select status from public.jobs
    where id = 'f6f6f6f5-1000-4f6f-8f6f-000000000001') = 'running'
  and
  (select claimed_by from public.jobs
    where id = 'f6f6f6f5-1000-4f6f-8f6f-000000000001') = 'w1',
  'a claimed job is running and records which worker took it'
);

select tests.assert_true (
  (select status from public.jobs
    where id = 'f6f6f6f5-1000-4f6f-8f6f-000000000003') = 'queued',
  'the browser job is untouched by the worker claim'
);

--- the heartbeat was recorded and follows the latest claim ---------------------
select tests.assert_true (
  (select current_job_id from public.worker_heartbeats where id = 'w1') is null,
  'the heartbeat stays after the queue runs dry (worker still online)'
);

-- --- a leader may not call the claim function ---------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd01","role":"authenticated"}';

do $$
begin
  perform public.claim_worker_job ('sneaky');
  raise exception 'ASSERT FAILED: a leader called the worker claim function';
exception
  when insufficient_privilege then
    null; -- expected: only the service role may claim
end $$;

--- heartbeats: admins read, other leaders see nothing, nobody writes ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.worker_heartbeats) = 2,
  'the admin reads worker heartbeats (both workers polled, empty claims included)'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddd02","role":"authenticated"}';

select tests.assert_true (
  (select count (*) from public.worker_heartbeats) = 0,
  'a non-admin leader reads no heartbeats'
);

do $$
begin
  insert into public.worker_heartbeats (id) values ('fake');
  raise exception 'ASSERT FAILED: a client wrote a heartbeat';
exception
  when insufficient_privilege then
    null; -- expected: only the server writes heartbeats
end $$;

--- anon reads nothing ----------------------------------------------------------
reset role;
set local role anon;

select tests.assert_true (
  (select count (*) from public.worker_heartbeats) = 0,
  'anon reads no heartbeats'
);

commit;
