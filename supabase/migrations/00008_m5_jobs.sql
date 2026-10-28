-- Study Hub — M5 Browser processing: the jobs queue (spec section 7).
-- Every processing task is a row in jobs. Light work (image OCR, Word to
-- Markdown, PDF merge/split) runs in the leader's browser; the Home Worker
-- (M6) and Gemini (M7) join later through the same table.

-- ---------------------------------------------------------------------------
-- jobs (spec section 5): the queue the runners poll.
-- type: what to do. status: the lifecycle of section 7 rule 1. runner: who is
-- allowed to execute it. params: job-specific settings as JSON, validated by
-- zod in the app before insert. attempts/run_after implement "retry up to 3
-- times with growing delay": a failed attempt goes back to queued with a
-- later run_after until attempts reaches 3, then the status is failed.
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid (),
  course_id uuid not null references public.courses (id) on delete cascade,
  type text not null check (type in ('ocr', 'convert', 'transcribe', 'ai_task')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'waiting_quota')),
  runner text not null check (runner in ('browser', 'worker', 'gemini')),
  input_asset_id uuid not null references public.assets (id) on delete cascade,
  params jsonb not null default '{}'::jsonb,
  result_asset_id uuid references public.assets (id) on delete set null,
  result_node_id uuid references public.nodes (id) on delete set null,
  error text,
  attempts integer not null default 0,
  run_after timestamptz not null default now (),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now (),
  updated_at timestamptz not null default now (),
  finished_at timestamptz
);

create index jobs_course_status_idx on public.jobs (course_id, status);
create index jobs_run_after_idx on public.jobs (status, run_after);

alter table public.jobs enable row level security;
alter table public.jobs force row level security;

-- ---------------------------------------------------------------------------
-- jobs RLS. Viewing (spec section 5 page matrix): admins and the leaders of
-- the course. Starting a job: the same roles that may upload assets (admin,
-- owner, editor, contributor). Updating: the job's creator runs it in their
-- browser and writes progress back — plus admins for administration.
-- There is no delete policy: cancelling is an update to failed, and the
-- history stays for the audit trail.
-- ---------------------------------------------------------------------------
create policy select_course_jobs on public.jobs
  as permissive for select to authenticated
  using (public.can_access_course (course_id));

create policy insert_writable_jobs on public.jobs
  as permissive for insert to authenticated
  with check (
    created_by = auth.uid ()
    and (
      public.is_admin ()
      or public.is_course_owner (course_id)
      or public.course_role (course_id) in ('editor', 'contributor')
    )
  );

create policy update_own_jobs on public.jobs
  as permissive for update to authenticated
  using (created_by = auth.uid () or public.is_admin ())
  with check (created_by = auth.uid () or public.is_admin ());

-- The job screen updates live (spec section 7 rule 1) through Supabase
-- Realtime, which only ships tables added to this publication.
alter publication supabase_realtime add table public.jobs;
